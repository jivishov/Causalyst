export const CANONICAL_LOCAL_AUTH_HOST = "127.0.0.1";
export const LOCAL_FRONTEND_PORT = "5173";
const LOCALHOST_NAMES = new Set(["localhost", "::1", "[::1]"]);
const LOOPBACK_NAMES = new Set([CANONICAL_LOCAL_AUTH_HOST, ...LOCALHOST_NAMES]);

export function getCanonicalLocalOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" || url.port !== LOCAL_FRONTEND_PORT || !LOCALHOST_NAMES.has(url.hostname)) {
      return origin;
    }
    url.hostname = CANONICAL_LOCAL_AUTH_HOST;
    return url.origin;
  } catch {
    return origin;
  }
}

export function getCanonicalLocalUrl(href: string): string | null {
  try {
    const url = new URL(href);
    const canonicalOrigin = getCanonicalLocalOrigin(url.origin);
    if (canonicalOrigin === url.origin) return null;
    return new URL(`${url.pathname}${url.search}${url.hash}`, canonicalOrigin).toString();
  } catch {
    return null;
  }
}

export function getLocalAuthOriginIssue(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" || !LOOPBACK_NAMES.has(url.hostname)) return null;
    if (url.port === LOCAL_FRONTEND_PORT) return null;
    return `Local Google sign-in must run from http://${CANONICAL_LOCAL_AUTH_HOST}:${LOCAL_FRONTEND_PORT}. Current origin is ${origin}. Stop any stale frontend server and restart Vite on port ${LOCAL_FRONTEND_PORT}.`;
  } catch {
    return null;
  }
}

export function isLocalFrontendOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:"
      && url.port === LOCAL_FRONTEND_PORT
      && (url.hostname === CANONICAL_LOCAL_AUTH_HOST || LOCALHOST_NAMES.has(url.hostname));
  } catch {
    return false;
  }
}
