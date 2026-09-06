export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (path.includes('oauth2redirect') || path.includes('oauth')) {
    return false;
  }
  return path;
}
