export interface AuthConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  storageKey: string;
  loginPath: string;
  callbackPath: string;
  protectedPath: string;
  operationTimeoutMs: number;
  localDev: {
    canonicalHost: string;
    port: string;
    enforceSingleOrigin: boolean;
  };
}

export const authConfig: AuthConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  storageKey: "google-oauth-template.auth",
  loginPath: "/login",
  callbackPath: normalizePath(import.meta.env.VITE_AUTH_CALLBACK_PATH || "/auth/callback"),
  protectedPath: "/",
  operationTimeoutMs: 20000,
  localDev: {
    canonicalHost: "127.0.0.1",
    port: "5173",
    enforceSingleOrigin: true
  }
};

export const isSupabaseConfigured = Boolean(
  authConfig.supabaseUrl
  && authConfig.supabaseAnonKey
  && !authConfig.supabaseUrl.includes("YOUR_PROJECT")
  && authConfig.supabaseAnonKey !== "replace-with-anon-key"
);

export function resolveAppUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return new URL(`${normalizedBase}${path.replace(/^\/+/, "")}`, window.location.origin).toString();
}

export function currentAppPath(): string {
  if (typeof window === "undefined") return "";
  const pathname = window.location?.pathname || "/";
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  if (!normalizedBase || normalizedBase === "/") return normalizePath(pathname);
  if (!pathname.startsWith(normalizedBase)) return normalizePath(pathname);
  return normalizePath(pathname.slice(normalizedBase.length));
}

export function normalizePath(path: string): string {
  const normalized = `/${path.replace(/^\/+/, "")}`.replace(/\/+$/, "");
  return normalized || "/";
}
