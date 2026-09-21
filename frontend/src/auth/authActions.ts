import { authConfig, isSupabaseConfigured, resolveAppUrl } from "./authConfig";
import { getCanonicalLocalOrigin } from "./localAuthOrigin";
import { authSupabase } from "./supabaseClient";

export async function signInWithGoogle(): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before using Google sign-in.");
  }
  assertSupportedLocalAuthOrigin();
  if (redirectToCanonicalLocalOriginIfNeeded()) return;

  const { error } = await withTimeout(
    authSupabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: resolveAppUrl(authConfig.callbackPath),
        queryParams: { prompt: "select_account" }
      }
    }),
    authConfig.operationTimeoutMs,
    "Google sign-in timed out."
  );
  if (error) throw new Error(resolveOAuthStartErrorMessage(error.message));
}

export async function signOutOfGoogle(): Promise<void> {
  if (!isSupabaseConfigured) return;
  await authSupabase.auth.signOut();
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assertSupportedLocalAuthOrigin(): void {
  if (typeof window === "undefined" || !authConfig.localDev.enforceSingleOrigin) return;
  const origin = new URL(window.location.href).origin;
  const url = new URL(origin);
  const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (loopback && url.port !== authConfig.localDev.port) {
    throw new Error(`Local Google sign-in must run from http://${authConfig.localDev.canonicalHost}:${authConfig.localDev.port}. Current origin is ${origin}.`);
  }
}

function redirectToCanonicalLocalOriginIfNeeded(): boolean {
  if (typeof window === "undefined") return false;
  const canonicalOrigin = getCanonicalLocalOrigin(window.location.origin);
  if (canonicalOrigin === window.location.origin) return false;
  window.location.replace(new URL(`${window.location.pathname}${window.location.search}${window.location.hash}`, canonicalOrigin).toString());
  return true;
}

function resolveOAuthStartErrorMessage(message: string): string {
  const trimmed = message.trim();
  const suffix = typeof window === "undefined" ? "" : ` Confirm Supabase Auth redirect URLs include ${resolveAppUrl(authConfig.callbackPath)}.`;
  if (/redirect|allow.?list|not allowed|site url/i.test(trimmed)) {
    return `${trimmed || "Google sign-in could not start."}${suffix}`;
  }
  return trimmed || "Google sign-in could not start.";
}
