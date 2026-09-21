import { authConfig } from "./authConfig";

const LOCALHOST_NAMES = new Set(["localhost", "::1", "[::1]"]);

function loopbackNames(): Set<string> {
  return new Set([authConfig.localDev.canonicalHost, ...LOCALHOST_NAMES]);
}

export function getCanonicalLocalOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    if (
      !authConfig.localDev.enforceSingleOrigin
      || url.protocol !== "http:"
      || url.port !== authConfig.localDev.port
      || !LOCALHOST_NAMES.has(url.hostname)
    ) {
      return origin;
    }
    url.hostname = authConfig.localDev.canonicalHost;
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
    if (!authConfig.localDev.enforceSingleOrigin) return null;
    const url = new URL(origin);
    if (url.protocol !== "http:" || !loopbackNames().has(url.hostname)) return null;
    if (url.port === authConfig.localDev.port) return null;
    return `Local Google sign-in must run from http://${authConfig.localDev.canonicalHost}:${authConfig.localDev.port}. Current origin is ${origin}. Restart Vite on the configured port before starting OAuth.`;
  } catch {
    return null;
  }
}
