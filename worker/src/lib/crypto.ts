import type { Env } from "./env";

export async function hashPin(pin: string, env: Pick<Env, "PIN_PEPPER">): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.PIN_PEPPER),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(pin));
  return bytesToHex(new Uint8Array(signature));
}

export async function signUploadToken(artifactId: string, userId: string, env: Pick<Env, "PIN_PEPPER">): Promise<string> {
  return signArtifactToken("upload", artifactId, userId, env);
}

export async function signPreviewToken(artifactId: string, userId: string, env: Pick<Env, "PIN_PEPPER">): Promise<string> {
  return signArtifactToken("preview", artifactId, userId, env);
}

export async function verifyPreviewToken(artifactId: string, userId: string, token: string, env: Pick<Env, "PIN_PEPPER">): Promise<boolean> {
  const expected = await signPreviewToken(artifactId, userId, env);
  return timingSafeEqual(expected, token);
}

async function signArtifactToken(scope: "upload" | "preview", artifactId: string, userId: string, env: Pick<Env, "PIN_PEPPER">): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.PIN_PEPPER),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const payload = `${scope}:${artifactId}:${userId}`;
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToHex(new Uint8Array(signature));
}

export async function verifyUploadToken(artifactId: string, userId: string, token: string, env: Pick<Env, "PIN_PEPPER">): Promise<boolean> {
  const expected = await signUploadToken(artifactId, userId, env);
  return timingSafeEqual(expected, token);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
