import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

afterEach(() => {
  vi.doUnmock("../src/lib/supabase");
  vi.doUnmock("@supabase/supabase-js");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

function session(token: string, expiresAt = Math.floor(Date.now() / 1000) + 3600): Session {
  return { access_token: token, refresh_token: "test-refresh", expires_at: expiresAt,
    expires_in: 3600, token_type: "bearer",
    user: { id: "student-1", email: "student@example.edu", is_anonymous: false,
      aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-02T00:00:00Z" } };
}

async function setup(refreshResult?: unknown) {
  let current = session("old-token");
  const refreshSession = vi.fn().mockImplementation(async () => refreshResult ?? { data: { session: session("new-token") }, error: null });
  const remember = vi.fn(value => { current = value; });
  const reset = vi.fn();
  vi.doMock("../src/lib/supabase", () => ({
    isSupabaseConfigured: true,
    hasStoredStudentAuthState: () => true,
    readStudentSupabaseSessionFallback: () => current,
    rememberStudentSupabaseSession: remember,
    resetStudentSupabaseAuthState: reset,
    studentSupabase: { auth: { refreshSession, getSession: vi.fn(), signOut: vi.fn() } },
    teacherSupabase: { auth: { refreshSession: vi.fn() } }
  }));
  const api = await import("../src/lib/api");
  return { api, refreshSession, remember, reset };
}

const rejected = () => new Response(JSON.stringify({ error: "Invalid bearer token" }), { status: 401 });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

describe("student request session recovery", () => {
  it("refreshes a rejected token and retries the same generation body once", async () => {
    const { api, refreshSession } = await setup();
    const fetch = vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(json({ jobId: "job-1" }));
    vi.stubGlobal("fetch", fetch);
    const body = JSON.stringify({ requestId: "request-1", description: "Student description" });
    await expect(api.apiFetch("/simulation/generate", { method: "POST", body })).resolves.toEqual({ jobId: "job-1" });
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(call => call[1].body)).toEqual([body, body]);
    expect(fetch.mock.calls.map(call => new Headers(call[1].headers).get("Authorization")))
      .toEqual(["Bearer old-token", "Bearer new-token"]);
    expect(fetch.mock.calls[0][0]).toBe(fetch.mock.calls[1][0]);
  });

  it("resumes the existing HTML stream at its cursor after token refresh", async () => {
    const { api, refreshSession } = await setup();
    const event = { type: "html_delta", cursor: 18, delta: "<html>" };
    const fetch = vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(
      new Response("data: " + JSON.stringify(event) + "\n\n", { headers: { "Content-Type": "text/event-stream" } })
    );
    vi.stubGlobal("fetch", fetch);
    const onEvent = vi.fn();
    await api.streamSimulationGenerationJob("job-1", { after: 17, signal: new AbortController().signal, onEvent });
    expect(onEvent).toHaveBeenCalledWith(event);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      "http://localhost:8787/api/simulation/jobs/job-1/stream?after=17",
      "http://localhost:8787/api/simulation/jobs/job-1/stream?after=17"
    ]);
    expect(new Headers(fetch.mock.calls[1][1].headers).get("Accept")).toBe("text/event-stream");
  });

  it("does not refresh or retry access denials", async () => {
    const { api, refreshSession } = await setup();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Access denied" }), { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(api.getSimulationGenerationJob("job-1")).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("stops after one refresh when the server still rejects the session", async () => {
    const { api, refreshSession } = await setup();
    const fetch = vi.fn().mockImplementation(async () => rejected());
    vi.stubGlobal("fetch", fetch);
    await expect(api.getSimulationGenerationJob("job-1")).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("shows a sign-in message when refresh is invalid without clearing saved state", async () => {
    const { api, reset } = await setup({ data: { session: null }, error: { status: 400, message: "Invalid refresh token" } });
    const fetch = vi.fn().mockResolvedValue(rejected());
    vi.stubGlobal("fetch", fetch);
    await expect(api.getSimulationGenerationJob("job-1")).rejects.toMatchObject({
      status: 401, code: "student_session_expired", message: expect.stringContaining("Sign in with Google again")
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("keeps temporary refresh failures recoverable for the existing job", async () => {
    const { api } = await setup({ data: { session: null }, error: { status: 503, message: "Auth unavailable" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rejected()));
    const error = await api.getSimulationGenerationJob("job-1").catch(error => error);
    expect(error).toBeInstanceOf(api.ApiConnectionError);
    expect(api.isRetryableApiError(error)).toBe(true);
  });

  it("shares one session refresh across simultaneous polling and streaming requests", async () => {
    const { api, refreshSession } = await setup();
    let resolveRefresh!: (value: unknown) => void;
    refreshSession.mockReturnValue(new Promise(resolve => { resolveRefresh = resolve; }));
    const fetch = vi.fn().mockImplementation(async (_url, init) =>
      new Headers(init.headers).get("Authorization") === "Bearer old-token" ? rejected() : json({ jobId: "job-1" })
    );
    vi.stubGlobal("fetch", fetch);
    const first = api.getSimulationGenerationJob("job-1");
    const second = api.getSimulationModelSettings("attempt-1");
    await vi.waitFor(() => expect(refreshSession).toHaveBeenCalledTimes(1));
    resolveRefresh({ data: { session: session("new-token") }, error: null });
    await Promise.all([first, second]);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("makes no request for an already cancelled stream", async () => {
    const { api, refreshSession } = await setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    controller.abort();
    await api.streamSimulationGenerationJob("job-1", { signal: controller.signal, onEvent: vi.fn() });
    expect(fetch).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
  });
});

describe("student cached token freshness", () => {
  async function realAuth(stored: ReturnType<typeof session>, recovered = stored) {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const values = new Map([["alt-assessment.student-auth", JSON.stringify(stored)]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => values.delete(key),
      key: (index: number) => Array.from(values.keys())[index] ?? null, get length() { return values.size; } };
    vi.stubGlobal("window", { location: { href: "https://school.example/assignments", pathname: "/assignments" },
      localStorage: storage, sessionStorage: { ...storage, getItem: () => null, length: 0 } });
    const getSession = vi.fn().mockResolvedValue({ data: { session: recovered }, error: null });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getSession } }) }));
    const supabase = await import("../src/lib/supabase");
    return { supabase, getSession };
  }

  it("uses the persisted refreshed token instead of the old OAuth snapshot", async () => {
    const { supabase } = await realAuth(session("refreshed-token"));
    supabase.rememberStudentSupabaseSession(session("callback-token"));
    expect(supabase.readStudentSupabaseSessionFallback()?.access_token).toBe("refreshed-token");
  });

  it.each([-30, 30])("recovers tokens %s seconds from expiry through Supabase", async offset => {
    const old = session("expired-token", Math.floor(Date.now() / 1000) + offset);
    const { supabase, getSession } = await realAuth(old, session("refreshed-token"));
    expect(supabase.readStudentSupabaseSessionFallback()).toBeNull();
    const { requireStudentSession } = await import("../src/lib/api");
    await expect(requireStudentSession()).resolves.toMatchObject({ access_token: "refreshed-token" });
    expect(getSession).toHaveBeenCalledTimes(1);
  });
});
