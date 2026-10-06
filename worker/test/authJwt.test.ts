import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/lib/env";

const env: Env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  OPENAI_API_KEY: "openai-key",
  PIN_PEPPER: "pepper",
  TEACHER_SETUP_CODE: "setup-code",
};

describe("Supabase bearer token verification", () => {
  afterEach(() => {
    vi.doUnmock("jose");
    vi.resetModules();
  });

  it("verifies Supabase access tokens with authenticated audience", async () => {
    const jwks = {};
    const createRemoteJWKSet = vi.fn(() => jwks);
    const jwtVerify = vi.fn().mockResolvedValue({
      payload: {
        sub: "student-1",
        aud: "authenticated",
        role: "authenticated",
        email: "student@example.com",
        app_metadata: {
          provider: "google",
          providers: ["google"]
        },
        amr: [{ method: "oauth" }]
      }
    });
    vi.doMock("jose", () => ({ createRemoteJWKSet, jwtVerify }));

    const { requireUser } = await import("../src/lib/auth");

    await expect(requireUser(bearerRequest("supabase-token"), env)).resolves.toMatchObject({
      userId: "student-1",
      token: "supabase-token",
      email: "student@example.com",
      isAnonymous: false,
      authProvider: "google",
      authProviders: ["google"],
      authMethods: ["oauth"]
    });
    expect(jwtVerify).toHaveBeenCalledWith("supabase-token", jwks, {
      issuer: "https://project.supabase.co/auth/v1",
      audience: "authenticated"
    });
  });

  it("rejects verified tokens that are not authenticated Supabase sessions", async () => {
    const createRemoteJWKSet = vi.fn(() => ({}));
    const jwtVerify = vi.fn().mockResolvedValue({
      payload: {
        sub: "student-1",
        aud: "authenticated",
        role: "anon",
        email: "student@example.com"
      }
    });
    vi.doMock("jose", () => ({ createRemoteJWKSet, jwtVerify }));

    const { requireUser } = await import("../src/lib/auth");

    await expect(requireUser(bearerRequest("anon-token"), env)).rejects.toMatchObject({
      status: 403,
      message: "Authenticated Supabase session required"
    });
  });

  it("rejects Google ID tokens before they reach student routes", async () => {
    const createRemoteJWKSet = vi.fn(() => ({}));
    const jwtVerify = vi.fn().mockRejectedValue(new Error("issuer mismatch"));
    vi.doMock("jose", () => ({ createRemoteJWKSet, jwtVerify }));

    const { requireUser } = await import("../src/lib/auth");

    await expect(requireUser(bearerRequest("google-id-token"), env)).rejects.toMatchObject({
      status: 401,
      message: "Invalid bearer token"
    });
  });
  it("validates real signed resource tokens, expiry, and exclusive audience", async () => {
    const jose = await vi.importActual<typeof import("jose")>("jose");
    const { publicKey, privateKey } = await jose.generateKeyPair("ES256");
    vi.doMock("jose", () => ({ ...jose, createRemoteJWKSet: vi.fn(() => publicKey) }));
    const { requireUser } = await import("../src/lib/auth");
    const resource = "https://worker.example/mcp/teacher";
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: "teacher-1", iss: `${env.SUPABASE_URL}/auth/v1`, aud: resource, exp: now + 60, iat: now,
      role: "authenticated", email: "teacher@example.test", client_id: "client-1", session_id: "session-1", scope: "openid email profile" };
    const sign = (changes: Record<string, unknown> = {}) => new jose.SignJWT({ ...claims, ...changes }).setProtectedHeader({ alg: "ES256" }).sign(privateKey);
    await expect(requireUser(bearerRequest(await sign()), env, resource)).resolves.toMatchObject({ userId: "teacher-1", oauthClientId: "client-1", sessionId: "session-1", oauthScopes: ["openid", "email", "profile"] });
    for (const invalid of [{ exp: undefined }, { exp: now - 1 }, { iss: "https://foreign.example" }, { aud: "authenticated" },
      { aud: [resource, "authenticated"] }, { session_id: undefined }, { client_id: undefined }, { nbf: now + 600 }]) {
      await expect(requireUser(bearerRequest(await sign(invalid)), env, resource)).rejects.toMatchObject({ status: 401 });
    }
    await expect(requireUser(bearerRequest(await sign({ aud: "authenticated" })), env)).rejects.toMatchObject({ status: 403 });
  });
});

function bearerRequest(token: string): Request {
  return new Request("https://worker.example/api/student/me", {
    headers: { Authorization: `Bearer ${token}` }
  });
}
