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
});

function bearerRequest(token: string): Request {
  return new Request("https://worker.example/api/student/me", {
    headers: { Authorization: `Bearer ${token}` }
  });
}
