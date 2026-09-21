import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";
import { HttpError } from "./http";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export interface AuthContext {
  userId: string;
  token: string;
  isAnonymous: boolean;
  email: string | null;
  authProvider: string | null;
  authProviders: string[];
  authMethods: string[];
}

export async function requireUser(request: Request, env: Env): Promise<AuthContext> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing bearer token");
  }

  const token = header.slice("Bearer ".length);
  const jwksUrl = env.SUPABASE_JWKS_URL ?? `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  let jwks = jwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksCache.set(jwksUrl, jwks);
  }

  const issuer = `${env.SUPABASE_URL}/auth/v1`;
  const result = await jwtVerify(token, jwks, { issuer, audience: "authenticated" }).catch(() => {
    throw new HttpError(401, "Invalid bearer token");
  });

  if (!result.payload.sub) {
    throw new HttpError(401, "Token is missing subject");
  }
  if (result.payload.role !== "authenticated") {
    throw new HttpError(403, "Authenticated Supabase session required");
  }

  return {
    userId: result.payload.sub,
    token,
    isAnonymous: result.payload.is_anonymous === true,
    email: typeof result.payload.email === "string" ? result.payload.email : null,
    authProvider: readAuthProvider(result.payload),
    authProviders: readAuthProviders(result.payload),
    authMethods: readAuthMethods(result.payload)
  };
}

export function requireStudentAuth(auth: AuthContext): AuthContext {
  if (auth.isAnonymous || !auth.email) {
    throw new HttpError(403, "Student Google sign-in required");
  }
  return auth;
}

export function requireTeacherAuthSession(auth: AuthContext): AuthContext {
  if (auth.isAnonymous || !auth.email) {
    throw new HttpError(403, "Teacher email session required");
  }
  if (usesKnownNonTeacherProvider(auth)) {
    throw new HttpError(403, "Teacher email/password session required");
  }
  return auth;
}

function usesKnownNonTeacherProvider(auth: AuthContext): boolean {
  const primaryProvider = normalizeAuthSignal(auth.authProvider);
  if (primaryProvider && primaryProvider !== "email") return true;

  if (!primaryProvider && auth.authProviders.length > 0) {
    const providers = auth.authProviders.map(normalizeAuthSignal).filter(Boolean);
    if (providers.length > 0 && !providers.includes("email")) return true;
  }

  return auth.authMethods
    .map(normalizeAuthSignal)
    .some((method) => method === "oauth" || method === "sso" || method === "anonymous");
}

function readAuthProvider(payload: Record<string, unknown>): string | null {
  const appMetadata = readRecord(payload.app_metadata);
  return readString(appMetadata?.provider);
}

function readAuthProviders(payload: Record<string, unknown>): string[] {
  const appMetadata = readRecord(payload.app_metadata);
  const providers = appMetadata?.providers;
  if (!Array.isArray(providers)) return [];
  return providers.filter((provider): provider is string => typeof provider === "string" && provider.trim() !== "");
}

function readAuthMethods(payload: Record<string, unknown>): string[] {
  const amr = payload.amr;
  if (!Array.isArray(amr)) return [];
  return amr.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) return [entry];
    const record = readRecord(entry);
    const method = readString(record?.method);
    return method ? [method] : [];
  });
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAuthSignal(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}
