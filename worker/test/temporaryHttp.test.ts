import { beforeEach, describe, it, expect, vi } from "vitest";
import { temporaryHttp } from "../src/routes/temporary";
import { command, digest, guestState, saveGuest } from "../src/lib/temporary";
import type { Env } from "../src/lib/env";
vi.mock("../src/lib/supabase", () => ({ serviceSupabase: vi.fn(() => ({})) }));
vi.mock("../src/lib/temporary", async (original) => ({
  ...(await original<object>()),
  command: vi.fn(),
  guestState: vi.fn(),
  saveGuest: vi.fn(),
}));
const env = {
  TEMPORARY_API_ORIGIN: "https://api.explain.test",
  TEMPORARY_SITE_ORIGIN: "https://explain.test",
} as Env;
const publicId = "c1000000-0000-4000-8000-000000000001",
  token = "a".repeat(64),
  cookie = "b".repeat(64);
function req(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`https://api.explain.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: "https://explain.test",
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(command).mockResolvedValue({ expiresAt: "2026-10-17T12:00:00Z" });
  vi.mocked(guestState).mockResolvedValue({} as never);
  vi.mocked(saveGuest).mockResolvedValue({ version: 1 });
});
describe("guest HTTP trust boundary", () => {
  it("exchanges fragment secrets for a host-only secure cookie without echoing credentials", async () => {
    const response = await temporaryHttp(
      req("/api/guest/exchange", { publicId, token }),
      env,
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(
      /^__Host-explain-guest=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Strict;/,
    );
    expect(setCookie).not.toContain("Domain=");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://explain.test",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain(token);
    const args = vi.mocked(command).mock.calls[0][4];
    expect(args).toMatchObject({ publicId, tokenHash: await digest(token) });
    expect(JSON.stringify(args)).not.toContain(`"token":"${token}"`);
  });
  it("rejects workers.dev cookies and foreign origins before accessing work", async () => {
    const foreign = await temporaryHttp(
      req(
        "/api/guest/exchange",
        { publicId, token },
        { Origin: "https://evil.test" },
      ),
      env,
    );
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const oldHost = await temporaryHttp(
      new Request("https://example.workers.dev/api/guest/work"),
      env,
    );
    expect(oldHost.status).toBe(503);
    expect(command).not.toHaveBeenCalled();
  });
  it("requires both the private cookie and its session-bound CSRF value on writes", async () => {
    const input = {
        text: "Synthetic",
        expectedVersion: 0,
        key: publicId,
        submit: false,
      },
      path = `/api/guest/work?publicId=${publicId}`;
    const rejected = await temporaryHttp(
      req(path, input, { Cookie: `__Host-explain-guest=${cookie}` }),
      env,
    );
    expect(rejected.status).toBe(403);
    expect(saveGuest).not.toHaveBeenCalled();
    const accepted = await temporaryHttp(
      req(path, input, {
        Cookie: `__Host-explain-guest=${cookie}`,
        "X-Explain-CSRF": await digest(`${cookie}:csrf`),
      }),
      env,
    );
    expect(accepted.status).toBe(200);
    expect(saveGuest).toHaveBeenCalledWith(
      expect.anything(),
      await digest(cookie),
      input,
      publicId,
    );
  });
  it("does not expose raw exceptions, submitted bodies or object paths in failures", async () => {
    vi.mocked(guestState).mockRejectedValue(
      new Error("Private answer text temporary-evidence/private/path.json"),
    );
    const response = await temporaryHttp(
      req(`/api/guest/work?publicId=${publicId}`, undefined, {
        Cookie: `__Host-explain-guest=${cookie}`,
      }),
      env,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "UNAVAILABLE",
      code: "UNAVAILABLE",
      retryable: true,
    });
  });
});
