import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("frontend auth separation", () => {
  afterEach(() => {
    vi.doUnmock("@supabase/supabase-js");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("creates student and teacher Supabase clients with distinct storage keys, built-in locking, and manual callback handling", async () => {
    vi.resetModules();
    const createClient = vi.fn((url: string, key: string, options: unknown) => ({ url, key, options }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    await import("../src/lib/supabase");

    const authOptions = createClient.mock.calls.map((call) => (call[2] as { auth?: { storageKey?: string; detectSessionInUrl?: boolean; lock?: unknown } }).auth);
    const storageKeys = authOptions.map((auth) => auth?.storageKey);
    expect(storageKeys).toContain("alt-assessment.student-auth");
    expect(storageKeys).toContain("alt-assessment.teacher-auth");
    expect(new Set(storageKeys).size).toBe(storageKeys.length);
    expect(authOptions.every((auth) => !Object.prototype.hasOwnProperty.call(auth ?? {}, "lock"))).toBe(true);
    expect(authOptions.every((auth) => auth?.detectSessionInUrl === false)).toBe(true);
  });

  it("can clear browser auth and OAuth helper storage keys without developer tools", async () => {
    vi.resetModules();
    const createClient = vi.fn((url: string, key: string, options: unknown) => ({ url, key, options }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { resetSupabaseAuthState } = await import("../src/lib/supabase");
    const removed: string[] = [];
    const storage = createTestStorage({
      "alt-assessment.student-auth": "student-token",
      "alt-assessment.student-auth-code-verifier": "student-verifier",
      "alt-assessment.teacher-auth": "teacher-token",
      "alt-assessment.teacher-auth-code-verifier": "teacher-verifier",
      "alt-assessment.student-session.v2": "cached-session",
      unrelated: "keep"
    }, removed);

    resetSupabaseAuthState(storage);

    expect(new Set(removed)).toEqual(new Set([
      "alt-assessment.student-auth",
      "alt-assessment.student-auth-code-verifier",
      "alt-assessment.teacher-auth",
      "alt-assessment.teacher-auth-code-verifier"
    ]));
    expect(storage.remainingKeys()).toEqual([
      "alt-assessment.student-session.v2",
      "unrelated"
    ]);
  });

  it("can clear only student auth storage without touching teacher auth", async () => {
    vi.resetModules();
    const createClient = vi.fn((url: string, key: string, options: unknown) => ({ url, key, options }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { resetStudentSupabaseAuthState } = await import("../src/lib/supabase");
    const removed: string[] = [];
    const storage = createTestStorage({
      "alt-assessment.student-auth": "student-token",
      "alt-assessment.student-auth-code-verifier": "student-verifier",
      "alt-assessment.teacher-auth": "teacher-token",
      "alt-assessment.teacher-auth-code-verifier": "teacher-verifier",
      "alt-assessment.student-session.v2": "cached-session",
      unrelated: "keep"
    }, removed);

    resetStudentSupabaseAuthState(storage);

    expect(new Set(removed)).toEqual(new Set([
      "alt-assessment.student-auth",
      "alt-assessment.student-auth-code-verifier"
    ]));
    expect(storage.remainingKeys()).toEqual([
      "alt-assessment.student-session.v2",
      "alt-assessment.teacher-auth",
      "alt-assessment.teacher-auth-code-verifier",
      "unrelated"
    ]);
  });

  it("keeps Supabase clients from racing the explicit OAuth callback exchange", async () => {
    vi.resetModules();
    vi.stubGlobal("window", { location: { pathname: "/login" } });
    const createClient = vi.fn((url: string, key: string, options: unknown) => ({ url, key, options }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    await import("../src/lib/supabase");

    const authOptions = createClient.mock.calls.map((call) => (call[2] as { auth?: { storageKey?: string; flowType?: string; detectSessionInUrl?: boolean } }).auth);
    expect(authOptions).toEqual([
      expect.objectContaining({ storageKey: "alt-assessment.student-auth", flowType: "pkce", detectSessionInUrl: false }),
      expect.objectContaining({ storageKey: "alt-assessment.teacher-auth", flowType: "pkce", detectSessionInUrl: false })
    ]);
  });

  it("does not run the student callback exchange on teacher routes", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const exchangeCodeForSession = vi.fn();
    const createClient = vi.fn(() => ({
      auth: {
        exchangeCodeForSession,
        setSession: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/teacher?code=auth-code",
        pathname: "/teacher"
      },
      history: { replaceState: vi.fn() }
    });

    const { completeStudentAuthCallbackIfPresent } = await import("../src/lib/supabase");
    await completeStudentAuthCallbackIfPresent();

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("runs the student callback exchange from the site-url root fallback", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const session = {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { email: "student@example.edu" }
    };
    const exchangeCodeForSession = vi.fn().mockResolvedValue({
      data: {
        session,
        user: session.user,
        redirectType: null
      },
      error: null
    });
    const createClient = vi.fn(() => ({
      auth: {
        exchangeCodeForSession,
        setSession: vi.fn()
      }
    }));
    const replaceState = vi.fn();
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/?code=auth-code&state=provider-state",
        pathname: "/"
      },
      history: { replaceState },
      localStorage: createBrowserStorage({
        "alt-assessment.student-auth-code-verifier": "pkce-verifier"
      }),
      sessionStorage: createBrowserStorage({})
    });

    const { completeStudentAuthCallbackIfPresent } = await import("../src/lib/supabase");
    await expect(completeStudentAuthCallbackIfPresent()).resolves.toMatchObject({
      access_token: "access-token",
      refresh_token: "refresh-token"
    });

    expect(exchangeCodeForSession).toHaveBeenCalledWith("auth-code");
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://school.example/");
  });

  it("reports initial auth callback signals for login diagnostics", async () => {
    await expectAuthCallbackSnapshot("https://school.example/login", {
      path: "/login",
      hasCode: false,
      hasHashToken: false,
      hasProviderError: false,
      hasEmptyHash: false
    });
    await expectAuthCallbackSnapshot("https://school.example/login?code=auth-code", {
      path: "/login",
      hasCode: true,
      hasHashToken: false,
      hasProviderError: false,
      hasEmptyHash: false
    });
    await expectAuthCallbackSnapshot("https://school.example/login#access_token=token&refresh_token=refresh", {
      path: "/login",
      hasCode: false,
      hasHashToken: true,
      hasProviderError: false,
      hasEmptyHash: false
    });
    await expectAuthCallbackSnapshot("https://school.example/login?error=server_error", {
      path: "/login",
      hasCode: false,
      hasHashToken: false,
      hasProviderError: true,
      hasEmptyHash: false
    });
    await expectAuthCallbackSnapshot("https://school.example/login#", {
      path: "/login",
      hasCode: false,
      hasHashToken: false,
      hasProviderError: false,
      hasEmptyHash: true
    });
  });

  it("does not treat a bare empty hash as an actionable auth callback", async () => {
    vi.resetModules();
    const createClient = vi.fn((url: string, key: string, options: unknown) => ({ url, key, options }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { hasActionableAuthCallbackSignal } = await import("../src/lib/supabase");

    expect(hasActionableAuthCallbackSignal({
      path: "/login",
      hasCode: false,
      hasHashToken: false,
      hasProviderError: false,
      hasEmptyHash: true
    })).toBe(false);
    expect(hasActionableAuthCallbackSignal({
      path: "/login",
      hasCode: true,
      hasHashToken: false,
      hasProviderError: false,
      hasEmptyHash: false
    })).toBe(true);
  });

  it("exchanges a student login code before session bootstrap and clears callback URL markers", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const session = {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { email: "student@example.edu" }
    };
    const createClient = vi.fn(() => ({
      auth: {
        exchangeCodeForSession: vi.fn(async () => {
          localStorage.removeItem("alt-assessment.student-auth-code-verifier");
          return {
            data: {
              session,
              user: session.user,
              redirectType: null
            },
            error: null
          };
        }),
        setSession: vi.fn()
      }
    }));
    const replaceState = vi.fn();
    const localStorage = createBrowserStorage({
      "alt-assessment.student-auth-code-verifier": JSON.stringify("pkce-verifier")
    });
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/login?authDebug=1&code=auth-code&state=provider-state",
        pathname: "/login"
      },
      history: { replaceState },
      localStorage,
      sessionStorage: createBrowserStorage({})
    });

    const { completeStudentAuthCallbackIfPresent } = await import("../src/lib/supabase");
    await expect(completeStudentAuthCallbackIfPresent()).resolves.toMatchObject({
      access_token: "access-token",
      refresh_token: "refresh-token"
    });

    const studentClient = createClient.mock.results[0].value;
    expect(studentClient.auth.exchangeCodeForSession).toHaveBeenCalledWith("auth-code");
    expect(localStorage.getItem("alt-assessment.student-auth-code-verifier")).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://school.example/login?authDebug=1");
  });

  it("surfaces missing PKCE verifier guidance instead of hanging on callback completion", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const exchangeCodeForSession = vi.fn();
    const createClient = vi.fn(() => ({
      auth: {
        exchangeCodeForSession,
        setSession: vi.fn()
      }
    }));
    const replaceState = vi.fn();
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/login?authDebug=1&code=auth-code&state=provider-state",
        pathname: "/login"
      },
      history: { replaceState },
      localStorage: createBrowserStorage({}),
      sessionStorage: createBrowserStorage({})
    });

    const { completeStudentAuthCallbackIfPresent } = await import("../src/lib/supabase");
    await expect(completeStudentAuthCallbackIfPresent()).rejects.toThrow("https://school.example/login");

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://school.example/login?authDebug=1");
  });

  it("sets an implicit hash session when a hash token callback reaches student login", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const setSession = vi.fn().mockResolvedValue({ error: null });
    const createClient = vi.fn(() => ({
      auth: {
        exchangeCodeForSession: vi.fn(),
        setSession
      }
    }));
    const replaceState = vi.fn();
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/login#access_token=access&refresh_token=refresh",
        pathname: "/login"
      },
      history: { replaceState }
    });

    const { completeStudentAuthCallbackIfPresent } = await import("../src/lib/supabase");
    await completeStudentAuthCallbackIfPresent();

    expect(setSession).toHaveBeenCalledWith({
      access_token: "access",
      refresh_token: "refresh"
    });
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://school.example/login");
  });

  it("keeps the student session provider out of the root and teacher route", () => {
    const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

    expect(mainSource).not.toContain("SessionProvider");
    expect(appSource.indexOf('path="/teacher/*"')).toBeGreaterThanOrEqual(0);
    expect(appSource.indexOf('path="/teacher/*"')).toBeLessThan(appSource.indexOf("<SessionProvider>"));
  });
});

function createTestStorage(values: Record<string, string>, removed: string[]) {
  const entries = new Map(Object.entries(values));
  return {
    get length() {
      return entries.size;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      removed.push(key);
      entries.delete(key);
    },
    remainingKeys() {
      return Array.from(entries.keys()).sort();
    }
  };
}

function createBrowserStorage(values: Record<string, string>) {
  const entries = new Map(Object.entries(values));
  return {
    get length() {
      return entries.size;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    getItem(key: string) {
      return entries.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
    removeItem(key: string) {
      entries.delete(key);
    }
  };
}

async function expectAuthCallbackSnapshot(
  href: string,
  expected: {
    path: string;
    hasCode: boolean;
    hasHashToken: boolean;
    hasProviderError: boolean;
    hasEmptyHash: boolean;
  }
) {
  vi.resetModules();
  const createClient = vi.fn((url: string, key: string, options: unknown) => ({ url, key, options }));
  vi.doMock("@supabase/supabase-js", () => ({ createClient }));
  const url = new URL(href);
  vi.stubGlobal("window", {
    location: {
      href,
      pathname: url.pathname
    }
  });

  const { initialAuthCallbackSnapshot } = await import("../src/lib/supabase");

  expect(initialAuthCallbackSnapshot).toEqual(expected);
}
