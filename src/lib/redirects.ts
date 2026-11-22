/** Paths the web app is allowed to redirect back to after authentication. */
const SAFE_PREFIXES = ['/dashboard', '/link', '/policies'];

/**
 * Decodes a path a couple of times so encoded protocol-relative paths
 * (e.g. `/%2f%2fevil.com`) cannot slip through the checks below.
 */
function decodeForValidation(value: string): string | null {
  let decoded = value;
  for (let i = 0; i < 2; i += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function hasUnsafeCharacters(value: string): boolean {
  if (value.includes('\\')) return true;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isSafePath(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return false;
  if (hasUnsafeCharacters(trimmed)) return false;

  const decoded = decodeForValidation(trimmed);
  if (!decoded) return false;
  if (decoded.startsWith('//') || hasUnsafeCharacters(decoded)) return false;

  const pathname = decoded.split(/[?#]/, 1)[0] ?? '';
  if (pathname.split('/').includes('..')) return false;

  return SAFE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Restricts a user-provided redirect to known internal paths. Anything else
 * (external URLs, protocol-relative URLs, backslashes, control characters)
 * falls back to the dashboard.
 */
export function getSafeRedirect(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (isSafePath(raw)) return raw.trim();
  return isSafePath(fallback) ? fallback.trim() : '/dashboard';
}

/** Adds, replaces, or removes the `invite` query param while preserving the rest of the URL. */
function setInviteParam(path: string, token: string | null): string {
  const hashIndex = path.indexOf('#');
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : '';
  const beforeHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const queryIndex = beforeHash.indexOf('?');
  const pathname = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';
  const params = new URLSearchParams(query);

  if (token === null && !params.has('invite')) return path;
  if (token !== null && params.get('invite') === token) return path;

  if (token === null) params.delete('invite');
  else params.set('invite', token);

  const nextQuery = params.toString();
  return `${pathname}${nextQuery ? `?${nextQuery}` : ''}${hash}`;
}

/** Removes the `invite` query param (used after the server has consumed it). */
export function stripInviteParam(path: string): string {
  return setInviteParam(path, null);
}

/** Keeps the `invite` query param on a redirect so it can be accepted once. */
export function withInviteParam(path: string, token: string): string {
  return setInviteParam(path, token);
}
