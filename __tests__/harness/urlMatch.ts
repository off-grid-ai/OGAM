/**
 * Whether a request URL belongs to a fake server: the same parsed origin, and a path under `base`'s path.
 *
 * Fakes route requests by URL. A string prefix check ("starts with https://host") also matches
 * https://host.evil.example, so compare the parsed origin, never a substring.
 */
export function isUnder(url: string, base: string): boolean {
  let request: URL;
  let root: URL;
  try {
    request = new URL(url);
    root = new URL(base);
  } catch {
    return false;
  }
  if (request.origin !== root.origin) return false;
  const rootPath = root.pathname.replace(/\/$/, '');
  return rootPath === '' || request.pathname === rootPath || request.pathname.startsWith(`${rootPath}/`);
}
