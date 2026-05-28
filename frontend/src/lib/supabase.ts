import { createClient, type Session } from "@supabase/supabase-js";
import { getCanonicalLocalUrl } from "./localAuthOrigin";

const supabaseUrl = normalizeEnvValue(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const supabaseAnonKey = normalizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);
const STUDENT_AUTH_STORAGE_KEY = "alt-assessment.student-auth";
const STUDENT_AUTH_STORAGE_PREFIXES = [STUDENT_AUTH_STORAGE_KEY] as const;
const STUDENT_AUTH_STORAGE_FALLBACK_KEYS = STUDENT_AUTH_STORAGE_PREFIXES.flatMap((key) => [
  key,
  `${key}-code-verifier`
]);

type AuthStorage = Pick<Storage, "length" | "key" | "removeItem">;
type ReadableAuthStorage = Pick<Storage, "getItem">;

export interface AuthCallbackSnapshot {
  path: string;
  hasCode: boolean;
  hasHashToken: boolean;
  hasProviderError: boolean;
  hasEmptyHash: boolean;
}

export const initialAuthCallbackSnapshot = createAuthCallbackSnapshot();
let studentAuthCallbackCompletion: Promise<Session | null> | null = null;
let lastCompletedStudentSession: Session | null = null;

export function getCurrentAuthCallbackSnapshot(): AuthCallbackSnapshot {
  return createAuthCallbackSnapshot();
}

export function hasActionableAuthCallbackSignal(snapshot: AuthCallbackSnapshot): boolean {
  return snapshot.hasCode || snapshot.hasHashToken || snapshot.hasProviderError;
}

export function isStudentAuthCallbackSnapshot(snapshot: AuthCallbackSnapshot): boolean {
  return isStudentAuthCallbackPath(snapshot.path) && hasActionableAuthCallbackSignal(snapshot);
}

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes("YOUR_PROJECT") &&
  supabaseAnonKey !== "replace-with-anon-key"
);

if (!isSupabaseConfigured) {
  console.warn("Missing Supabase frontend environment variables.");
}

function createBrowserSupabaseClient(storageKey: string) {
  return createClient(supabaseUrl || "https://example.supabase.co", supabaseAnonKey || "missing", {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      flowType: "pkce",
      detectSessionInUrl: false,
      storageKey
    }
  });
}

function normalizeEnvValue(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export const studentSupabase = createBrowserSupabaseClient(
  STUDENT_AUTH_STORAGE_KEY
);

export function resetStudentSupabaseAuthState(storage?: AuthStorage): void {
  resetAuthCompletionState();
  const storages = storage ? [storage] : getBrowserAuthStorages();
  for (const authStorage of storages) {
    removeAppAuthStorageKeys(authStorage, STUDENT_AUTH_STORAGE_PREFIXES, STUDENT_AUTH_STORAGE_FALLBACK_KEYS);
  }
}

function resetAuthCompletionState(): void {
  studentAuthCallbackCompletion = null;
  lastCompletedStudentSession = null;
}

export async function completeStudentAuthCallbackIfPresent(
  snapshot: AuthCallbackSnapshot = getCurrentAuthCallbackSnapshot()
): Promise<Session | null> {
  if (!isSupabaseConfigured || typeof window === "undefined") return null;
  if (!isStudentAuthCallbackSnapshot(snapshot)) return null;
  studentAuthCallbackCompletion ??= completeStudentAuthCallback();
  return studentAuthCallbackCompletion;
}

export function readStudentSupabaseSessionFallback(): Session | null {
  if (lastCompletedStudentSession && isUsableSession(lastCompletedStudentSession)) {
    return lastCompletedStudentSession;
  }
  return readStoredStudentSession();
}

export function rememberStudentSupabaseSession(session: Session | null): void {
  if (session && isUsableSession(session)) {
    lastCompletedStudentSession = session;
  }
}

export function hasStoredStudentAuthState(): boolean {
  if (STUDENT_AUTH_STORAGE_FALLBACK_KEYS.some((key) => readStorageItem(key) !== null)) {
    return true;
  }
  for (const storage of getBrowserAuthStorages()) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && isAppAuthStorageKey(key, STUDENT_AUTH_STORAGE_PREFIXES)) return true;
      }
    } catch {
      // Ignore unavailable storage.
    }
  }
  return false;
}

function currentAppPath(): string {
  if (typeof window === "undefined") return "";
  const pathname = window.location?.pathname || "/";
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  if (!normalizedBase || normalizedBase === "/") return pathname;
  if (!pathname.startsWith(normalizedBase)) return pathname;
  const withoutBase = pathname.slice(normalizedBase.length);
  return `/${withoutBase.replace(/^\/+/, "")}`;
}

function isStudentAuthCallbackPath(path: string): boolean {
  const normalizedPath = path.replace(/\/+$/, "") || "/";
  return normalizedPath === "/" || normalizedPath === "/login";
}

function createAuthCallbackSnapshot(): AuthCallbackSnapshot {
  if (typeof window === "undefined") {
    return {
      path: "",
      hasCode: false,
      hasHashToken: false,
      hasProviderError: false,
      hasEmptyHash: false
    };
  }
  const href = window.location.href || `http://localhost${window.location.pathname || "/"}`;
  const url = new URL(href);
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const hashParams = new URLSearchParams(hash);
  return {
    path: currentAppPath(),
    hasCode: url.searchParams.has("code"),
    hasHashToken: hashParams.has("access_token") || hashParams.has("refresh_token"),
    hasProviderError: url.searchParams.has("error")
      || url.searchParams.has("error_code")
      || url.searchParams.has("error_description")
      || hashParams.has("error")
      || hashParams.has("error_description"),
    hasEmptyHash: href.includes("#") && hash === ""
  };
}

async function completeStudentAuthCallback(): Promise<Session | null> {
  const url = new URL(window.location.href);
  const hashParams = parseUrlHash(url);
  const providerError = readProviderError(url, hashParams);
  if (providerError) {
    clearAuthCallbackUrl(url);
    throw new Error(providerError);
  }

  try {
    const code = url.searchParams.get("code");
    if (code) {
      lastCompletedStudentSession = await exchangeStudentCodeForSession(code);
      return lastCompletedStudentSession;
    }

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (accessToken && refreshToken) {
      const { data, error } = await studentSupabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (error) throw new Error(error.message);
      lastCompletedStudentSession = data?.session ?? null;
      return lastCompletedStudentSession;
    }
    return null;
  } finally {
    clearAuthCallbackUrl(url);
  }
}

function parseUrlHash(url: URL): URLSearchParams {
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  return new URLSearchParams(hash);
}

function readProviderError(url: URL, hashParams: URLSearchParams): string | null {
  const message = url.searchParams.get("error_description")
    ?? hashParams.get("error_description")
    ?? url.searchParams.get("error")
    ?? hashParams.get("error")
    ?? url.searchParams.get("error_code")
    ?? hashParams.get("error_code");
  return message ? `Google sign-in failed: ${message}` : null;
}

function clearAuthCallbackUrl(url: URL): void {
  for (const key of ["code", "state", "error", "error_code", "error_description"]) {
    url.searchParams.delete(key);
  }
  url.hash = "";
  window.history.replaceState(null, "", url.toString());
}

async function exchangeStudentCodeForSession(code: string): Promise<Session> {
  const codeVerifier = readStudentCodeVerifier();
  if (!codeVerifier) {
    const storedSession = readStoredStudentSession();
    if (storedSession) return storedSession;
    throw new Error(readMissingCodeVerifierMessage());
  }

  const { data, error } = await studentSupabase.auth.exchangeCodeForSession(code);
  if (error) {
    if (isMissingCodeVerifierError(error)) throw new Error(readMissingCodeVerifierMessage());
    throw new Error(error.message);
  }

  const session = data?.session ?? null;
  if (!session) {
    throw new Error("Google sign-in returned an invalid session.");
  }
  lastCompletedStudentSession = session;
  return session;
}

function readMissingCodeVerifierMessage(): string {
  return `Google sign-in could not be completed because this browser is missing the PKCE verifier. Use Reset sign-in, then start again from ${resolveStudentLoginRecoveryUrl()} without switching host, port, browser profile, or private browsing state.`;
}

function isMissingCodeVerifierError(error: { message?: string; name?: string }): boolean {
  const message = error.message?.toLowerCase() ?? "";
  const name = error.name?.toLowerCase() ?? "";
  return name.includes("pkce") || (message.includes("pkce") && message.includes("verifier"));
}

function readStudentCodeVerifier(): string | null {
  const raw = readStorageItem(`${STUDENT_AUTH_STORAGE_KEY}-code-verifier`);
  if (!raw) return null;
  const parsed = parseStoredJson(raw);
  const value = typeof parsed === "string" ? parsed : raw;
  const [codeVerifier] = value.split("/");
  return codeVerifier || null;
}

function readStorageItem(key: string): string | null {
  for (const storage of getReadableAuthStorages()) {
    try {
      const value = storage.getItem(key);
      if (value) return value;
    } catch {
      // Ignore unavailable storage.
    }
  }
  return null;
}

function parseStoredJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getBrowserAuthStorages(): AuthStorage[] {
  if (typeof window === "undefined") return [];
  const storages: AuthStorage[] = [];
  try {
    storages.push(window.localStorage);
  } catch {
    // Ignore unavailable storage. The reset path is best-effort recovery.
  }
  try {
    storages.push(window.sessionStorage);
  } catch {
    // Ignore unavailable storage. The reset path is best-effort recovery.
  }
  return storages;
}

function getReadableAuthStorages(): ReadableAuthStorage[] {
  if (typeof window === "undefined") return [];
  const storages: ReadableAuthStorage[] = [];
  try {
    storages.push(window.localStorage);
  } catch {
    // Ignore unavailable storage.
  }
  try {
    storages.push(window.sessionStorage);
  } catch {
    // Ignore unavailable storage.
  }
  return storages;
}

function readStoredStudentSession(): Session | null {
  if (typeof window === "undefined") return null;
  const storages: ReadableAuthStorage[] = [];
  try {
    storages.push(window.localStorage);
  } catch {
    // Ignore unavailable storage.
  }
  try {
    storages.push(window.sessionStorage);
  } catch {
    // Ignore unavailable storage.
  }
  for (const storage of storages) {
    const session = readStoredSessionFrom(storage);
    if (session) return session;
  }
  return null;
}

function readStoredSessionFrom(storage: ReadableAuthStorage): Session | null {
  try {
    const raw = storage.getItem(STUDENT_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const session = extractStoredSession(parsed);
    return session && isUsableSession(session) ? session : null;
  } catch {
    return null;
  }
}

function extractStoredSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  if (isUsableSession(value)) return value;
  const candidate = value as { currentSession?: unknown; session?: unknown };
  if (isUsableSession(candidate.currentSession)) return candidate.currentSession;
  if (isUsableSession(candidate.session)) return candidate.session;
  return null;
}

function isUsableSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as { access_token?: unknown; expires_at?: unknown };
  if (typeof session.access_token !== "string" || !session.access_token.trim()) return false;
  if (typeof session.expires_at === "number" && session.expires_at * 1000 < Date.now() - 60000) {
    return false;
  }
  return true;
}

function resolveStudentLoginRecoveryUrl(): string {
  if (typeof window === "undefined") return "the login page";
  try {
    const base = import.meta.env.BASE_URL || "/";
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    const origin = window.location.origin || new URL(window.location.href).origin;
    const loginUrl = new URL(`${normalizedBase}login`, origin).toString();
    return getCanonicalLocalUrl(loginUrl) ?? loginUrl;
  } catch {
    return "the login page";
  }
}

function removeAppAuthStorageKeys(
  storage: AuthStorage,
  prefixes: readonly string[],
  fallbackKeys: readonly string[]
): void {
  const keys = new Set<string>();
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && isAppAuthStorageKey(key, prefixes)) keys.add(key);
    }
  } catch {
    removeFallbackAuthStorageKeys(storage, fallbackKeys);
    return;
  }

  for (const key of keys) {
    safelyRemoveStorageKey(storage, key);
  }
}

function removeFallbackAuthStorageKeys(storage: Pick<Storage, "removeItem">, fallbackKeys: readonly string[]): void {
  for (const key of fallbackKeys) {
    safelyRemoveStorageKey(storage, key);
  }
}

function safelyRemoveStorageKey(storage: Pick<Storage, "removeItem">, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore locked-down browser storage failures during recovery.
  }
}

function isAppAuthStorageKey(key: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}-`));
}
