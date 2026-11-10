export function getInlineMimeType(fileName: string): string | null {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'txt':
    case 'log':
    case 'py':
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
    case 'java':
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'cs':
    case 'go':
    case 'rs':
    case 'rb':
    case 'php':
    case 'sh':
    case 'sql':
    case 'md':
    case 'csv':
    case 'yml':
    case 'yaml':
    case 'ini':
    case 'cfg':
    case 'tex':
    case 'r':
    case 'm':
      return 'text/plain;charset=utf-8';
    case 'json':
      return 'application/json;charset=utf-8';
    case 'html':
    case 'htm':
      return 'text/html;charset=utf-8';
    case 'xml':
      return 'text/xml;charset=utf-8';
    default:
      return null;
  }
}
export function getFileEmoji(fileName: string): string {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'pdf':
      return '📕';
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return '📦';
    case 'doc':
    case 'docx':
      return '📘';
    case 'ppt':
    case 'pptx':
      return '📙';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return '📗';
    case 'py':
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'c':
    case 'cpp':
    case 'h':
    case 'java':
    case 'html':
      return '💻';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return '🖼️';
    case 'mp4':
    case 'mkv':
    case 'avi':
    case 'mov':
      return '🎬';
    case 'mp3':
    case 'wav':
    case 'flac':
      return '🎵';
    default:
      return '📄';
  }
}

