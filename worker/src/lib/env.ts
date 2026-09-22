export interface Env {
  REALTIME_SESSIONS?: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWKS_URL?: string;
  OPENAI_API_KEY: string;
  MOONSHOT_API_KEY?: string;
  ZAI_API_KEY?: string;
  PIN_PEPPER: string;
  TEACHER_SETUP_CODE?: string;
  APP_ENV?: string;
  ALLOWED_ORIGINS?: string;
}

export function requireEnv(env: Env, key: keyof Env): string {
  const value = env[key];
  if (typeof value !== "string" || !value) throw new Error(`Missing required environment variable ${key}`);
  return value;
}

export function isProductionEnv(env: Pick<Env, "APP_ENV">): boolean {
  return ["prod", "production"].includes((env.APP_ENV ?? "").trim().toLowerCase());
}

export function validateWorkerSecrets(env: Pick<Env, "APP_ENV" | "PIN_PEPPER" | "TEACHER_SETUP_CODE" | "ALLOWED_ORIGINS">): void {
  const pepper = (env.PIN_PEPPER ?? "").trim();
  if (!pepper) {
    throw new Error("Missing required environment variable PIN_PEPPER");
  }

  if (!isProductionEnv(env)) return;

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "").trim();
  if (!allowedOrigins) {
    throw new Error("ALLOWED_ORIGINS must be configured in production");
  }

  if (isWeakSecret(pepper) || pepper.length < 32) {
    throw new Error("PIN_PEPPER must be a high-entropy production secret; rotating it invalidates unclaimed PINs and pending upload tokens");
  }

  const setupCode = (env.TEACHER_SETUP_CODE ?? "").trim();
  if (!setupCode || isWeakSecret(setupCode) || setupCode.length < 16) {
    throw new Error("TEACHER_SETUP_CODE must be a non-default production setup secret");
  }
}

function isWeakSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (["dev-pepper", "change-me", "changeme", "password", "secret", "replace-me", "replace-with-setup-code"].includes(normalized)) {
    return true;
  }
  return /^(.)\1+$/.test(normalized);
}
