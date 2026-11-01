import { CourseFolder } from './types.js';
import { MoodleApiError } from './moodleApi.js';

export interface ZipEntryInput {
  /** Forward-slash relative path inside the archive, e.g. "מועד א 2026/פתרון.pdf" */
  path: string;
  data: Uint8Array;
  lastModified?: Date;
}

// Precompute IEEE 802.3 CRC-32 table (polynomial 0xEDB88320)
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c >>> 0;
}

export function computeCrc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dateToDosTime(date: Date): { dosTime: number; dosDate: number } {
  const d = date || new Date();
  const year = Math.max(1980, d.getFullYear());
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = Math.floor(d.getSeconds() / 2);

  const dosTime = ((hours & 0x1F) << 11) | ((minutes & 0x3F) << 5) | (seconds & 0x1F);
  const dosDate = (((year - 1980) & 0x7F) << 9) | ((month & 0x0F) << 5) | (day & 0x1F);

  return { dosTime, dosDate };
}

function sanitizeAndDeduplicatePaths(entries: ZipEntryInput[]): { pathBytes: Uint8Array; entry: ZipEntryInput }[] {
  const encoder = new TextEncoder();
  const seenPaths = new Map<string, number>();
  const result: { pathBytes: Uint8Array; entry: ZipEntryInput }[] = [];

  for (const entry of entries) {
    let cleanPath = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    cleanPath = cleanPath.replace(/\.\./g, '').replace(/\/{2,}/g, '/');

    const lower = cleanPath.toLowerCase();
    const count = seenPaths.get(lower) || 0;
    seenPaths.set(lower, count + 1);

    if (count > 0) {
      const slashIndex = cleanPath.lastIndexOf('/');
      const fileName = slashIndex >= 0 ? cleanPath.slice(slashIndex + 1) : cleanPath;
      const dirPrefix = slashIndex >= 0 ? cleanPath.slice(0, slashIndex + 1) : '';
      const dotIndex = fileName.lastIndexOf('.');
      if (dotIndex > 0) {
        const base = fileName.slice(0, dotIndex);
        const ext = fileName.slice(dotIndex);
        cleanPath = `${dirPrefix}${base} (${count + 1})${ext}`;
      } else {
        cleanPath = `${dirPrefix}${fileName} (${count + 1})`;
      }
    }

    result.push({
      pathBytes: encoder.encode(cleanPath),
      entry,
    });
  }

  return result;
}

export function buildZipArchive(entries: ZipEntryInput[]): Uint8Array {
  const sanitized = sanitizeAndDeduplicatePaths(entries);

  // 1. Calculate required buffer size
  let totalLocalHeadersSize = 0;
  let totalCentralDirectorySize = 0;

  sanitized.forEach(({ pathBytes, entry }) => {
    // Local header: 30 bytes fixed + path length + data length
    totalLocalHeadersSize += 30 + pathBytes.length + entry.data.length;
    // Central directory header: 46 bytes fixed + path length
    totalCentralDirectorySize += 46 + pathBytes.length;
  });

  // End of Central Directory record: 22 bytes fixed
  const totalZipSize = totalLocalHeadersSize + totalCentralDirectorySize + 22;
  const buffer = new Uint8Array(totalZipSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let localOffset = 0;
  const centralDirectoryEntries: {
    pathBytes: Uint8Array;
    dosTime: number;
    dosDate: number;
    crc: number;
    size: number;
    offset: number;
  }[] = [];

  // 2. Write Local File Headers + Payloads
  for (const { pathBytes, entry } of sanitized) {
    const startOffset = localOffset;
    const crc = computeCrc32(entry.data);
    const size = entry.data.length;
    const { dosTime, dosDate } = dateToDosTime(entry.lastModified || new Date());

    // Local file header signature: 0x04034b50
    view.setUint32(localOffset, 0x04034b50, true);
    view.setUint16(localOffset + 4, 20, true); // Version needed to extract (2.0)
    view.setUint16(localOffset + 6, 0x0800, true); // Bit 11 set: UTF-8 filename flag
    view.setUint16(localOffset + 8, 0, true); // Compression method: 0 (STORE)
    view.setUint16(localOffset + 10, dosTime, true);
    view.setUint16(localOffset + 12, dosDate, true);
    view.setUint32(localOffset + 14, crc, true);
    view.setUint32(localOffset + 18, size, true); // Compressed size
    view.setUint32(localOffset + 22, size, true); // Uncompressed size
    view.setUint16(localOffset + 26, pathBytes.length, true);
    view.setUint16(localOffset + 28, 0, true); // Extra field length

    localOffset += 30;
    buffer.set(pathBytes, localOffset);
    localOffset += pathBytes.length;

    buffer.set(entry.data, localOffset);
    localOffset += entry.data.length;

    centralDirectoryEntries.push({
      pathBytes,
      dosTime,
      dosDate,
      crc,
      size,
      offset: startOffset,
    });
  }

  // 3. Write Central Directory Headers
  const cdOffset = localOffset;
  for (const cd of centralDirectoryEntries) {
    // Central directory header signature: 0x02014b50
    view.setUint32(localOffset, 0x02014b50, true);
    view.setUint16(localOffset + 4, 20, true); // Version made by
    view.setUint16(localOffset + 6, 20, true); // Version needed to extract
    view.setUint16(localOffset + 8, 0x0800, true); // Bit 11 set: UTF-8 filename flag
    view.setUint16(localOffset + 10, 0, true); // Compression method: 0 (STORE)
    view.setUint16(localOffset + 12, cd.dosTime, true);
    view.setUint16(localOffset + 14, cd.dosDate, true);
    view.setUint32(localOffset + 16, cd.crc, true);
    view.setUint32(localOffset + 20, cd.size, true); // Compressed size
    view.setUint32(localOffset + 24, cd.size, true); // Uncompressed size
    view.setUint16(localOffset + 28, cd.pathBytes.length, true);
    view.setUint16(localOffset + 30, 0, true); // Extra field length
    view.setUint16(localOffset + 32, 0, true); // File comment length
    view.setUint16(localOffset + 34, 0, true); // Disk number start
    view.setUint16(localOffset + 36, 0, true); // Internal file attributes
    view.setUint32(localOffset + 38, 0, true); // External file attributes
    view.setUint32(localOffset + 42, cd.offset, true); // Relative offset of local header

    localOffset += 46;
    buffer.set(cd.pathBytes, localOffset);
    localOffset += cd.pathBytes.length;
  }

  const cdSize = localOffset - cdOffset;

  // 4. Write End of Central Directory Record (EOCD)
  view.setUint32(localOffset, 0x06054b50, true); // Signature: 0x06054b50
  view.setUint16(localOffset + 4, 0, true); // Number of this disk
  view.setUint16(localOffset + 6, 0, true); // Disk with start of CD
  view.setUint16(localOffset + 8, centralDirectoryEntries.length, true); // CD records on this disk
  view.setUint16(localOffset + 10, centralDirectoryEntries.length, true); // Total CD records
  view.setUint32(localOffset + 12, cdSize, true); // Size of CD
  view.setUint32(localOffset + 16, cdOffset, true); // Offset of start of CD
  view.setUint16(localOffset + 20, 0, true); // Comment length

  return buffer;
}

export function buildAuthenticatedFileUrl(fileUrl: string, token: string): string {
  if (!fileUrl) return '';
  if (fileUrl.includes('token=')) return fileUrl;
  const separator = fileUrl.includes('?') ? '&' : '?';
  return `${fileUrl}${separator}token=${encodeURIComponent(token)}`;
}

export async function downloadFolderAsZip(
  folder: CourseFolder,
  token: string,
  onProgress?: (completed: number, total: number) => void
): Promise<Uint8Array> {
  if (!folder.files || folder.files.length === 0) {
    throw new Error('Folder is empty');
  }

  const entries: ZipEntryInput[] = [];
  const total = folder.files.length;
  let completed = 0;
  const CONCURRENCY = 4;

  for (let i = 0; i < total; i += CONCURRENCY) {
    const chunk = folder.files.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (file) => {
        const downloadUrl = buildAuthenticatedFileUrl(file.fileUrl, token);
        const res = await fetch(downloadUrl);
        if (!res.ok) {
          throw new Error(`Failed to download ${file.fileName} (HTTP ${res.status})`);
        }

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const clone = res.clone();
          try {
            const json = await clone.json();
            if (json && (json.exception || json.errorcode || json.error)) {
              throw new MoodleApiError(
                json.errorcode || json.error || 'exception',
                json.message || 'Moodle API Error on file download'
              );
            }
          } catch (e) {
            if (e instanceof MoodleApiError) throw e;
          }
        }

        const arrayBuf = await res.arrayBuffer();
        const data = new Uint8Array(arrayBuf);
        const rel = (file.relativePath || '')
          .replace(/\\/g, '/')
          .replace(/\.\./g, '')
          .replace(/^\/+/, '')
          .replace(/\/+$/, '');
        const entryPath = rel ? `${rel}/${file.fileName}` : file.fileName;

        entries.push({
          path: entryPath,
          data,
          lastModified: file.timeModified ? new Date(file.timeModified * 1000) : undefined,
        });

        completed++;
        onProgress?.(completed, total);
      })
    );
  }

  return buildZipArchive(entries);
}
