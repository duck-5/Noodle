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
