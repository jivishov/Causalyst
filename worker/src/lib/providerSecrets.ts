import type { Env } from "./env";
import { HttpError } from "./http";

// A separate HKDF context prevents reuse of the PIN/token signing key. Neither
// plaintext provider keys nor encryption material is stored in the database.
async function encryptionKey(env: Pick<Env, "PIN_PEPPER">): Promise<CryptoKey> {
  if (!env.PIN_PEPPER) throw new HttpError(503, "Secure credential storage is unavailable");
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PIN_PEPPER), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("causalyst-provider-keys-v1"),
    info: new TextEncoder().encode("teacher-and-attempt-credentials") }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptProviderSecret(value: string, scope: string, env: Pick<Env, "PIN_PEPPER">): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(scope) },
    await encryptionKey(env), new TextEncoder().encode(value));
  return `v1.${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}

export async function decryptProviderSecret(value: string, scope: string, env: Pick<Env, "PIN_PEPPER">): Promise<string> {
  try {
    const [version, iv, ciphertext, extra] = value.split(".");
    if (version !== "v1" || !iv || !ciphertext || extra) throw new Error("Invalid envelope");
    const decodedIv = decode(iv);
    if (decodedIv.length !== 12) throw new Error("Invalid IV");
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodedIv, additionalData: new TextEncoder().encode(scope) },
      await encryptionKey(env), decode(ciphertext));
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new HttpError(503, "The saved provider credential could not be opened. Ask your teacher to update it.");
  }
}

function base64(bytes: Uint8Array): string { return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join("")); }
function decode(value: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
