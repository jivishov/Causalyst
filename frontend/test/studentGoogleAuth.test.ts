import { afterEach, describe, expect, it, vi } from "vitest";

describe("student Google auth API", () => {
  afterEach(() => {
    vi.doUnmock("@supabase/supabase-js");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("starts Google OAuth with the login redirect and account chooser", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("window", { location: { origin: "https://school.example" } });

    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
    const createClient = vi.fn(() => ({
      auth: {
        getSession: vi.fn(),
        signInWithOAuth,
        signOut: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { signInStudentWithGoogle } = await import("../src/lib/api");
    await signInStudentWithGoogle();

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://school.example/login",
        queryParams: { prompt: "select_account" }
      }
    });
  });

  it("starts local Google OAuth from the canonical 127.0.0.1 dev origin", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:5173" } });

    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
    const createClient = vi.fn(() => ({
      auth: {
        getSession: vi.fn(),
        signInWithOAuth,
        signOut: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { signInStudentWithGoogle } = await import("../src/lib/api");
    await signInStudentWithGoogle();

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://127.0.0.1:5173/login",
        queryParams: { prompt: "select_account" }
      }
    });
  });

  it("rejects local Google OAuth on a non-allowlisted dev port with clear guidance", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:5174" } });

    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
    const createClient = vi.fn(() => ({
      auth: {
        getSession: vi.fn(),
        signInWithOAuth,
        signOut: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { signInStudentWithGoogle } = await import("../src/lib/api");
    await expect(signInStudentWithGoogle()).rejects.toThrow("http://127.0.0.1:5173");
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it("moves localhost dev sign-in to the canonical 127.0.0.1 origin before OAuth starts", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const replace = vi.fn();
    vi.stubGlobal("window", {
      location: {
        origin: "http://localhost:5173",
        replace
      }
    });

    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
    const createClient = vi.fn(() => ({
      auth: {
        getSession: vi.fn(),
        signInWithOAuth,
        signOut: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { signInStudentWithGoogle } = await import("../src/lib/api");
    await signInStudentWithGoogle();

    expect(replace).toHaveBeenCalledWith("http://127.0.0.1:5173/login?resetAuth=1");
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it("does not create anonymous sessions during student bootstrap", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");

    const signInAnonymously = vi.fn();
    const createClient = vi.fn(() => ({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        signInAnonymously,
        signInWithOAuth: vi.fn(),
        signOut: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { requireStudentSession } = await import("../src/lib/api");
    await expect(requireStudentSession()).rejects.toThrow("Sign in with Google to continue");
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("treats an empty student auth store as signed out without calling Supabase session recovery", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/login?authDebug=1",
        pathname: "/login"
      },
      localStorage: createStorage({}),
      sessionStorage: createStorage({})
    });

    const getSession = vi.fn().mockResolvedValue({ data: { session: null } });
    const createClient = vi.fn(() => ({
      auth: {
        getSession,
        signInAnonymously: vi.fn(),
        signInWithOAuth: vi.fn(),
        signOut: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { getStudentAuthEmail, requireStudentSession } = await import("../src/lib/api");

    await expect(getStudentAuthEmail()).resolves.toBeNull();
    await expect(requireStudentSession()).rejects.toThrow("Sign in with Google to continue");
    expect(getSession).not.toHaveBeenCalled();
  });

  it("uses the persisted student auth session when Supabase getSession stalls or rejects", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/login",
        pathname: "/login"
      },
      localStorage: createStorage({
        "alt-assessment.student-auth": JSON.stringify({
          access_token: "stored-access-token",
          refresh_token: "stored-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            email: "student@example.edu",
            is_anonymous: false
          }
        })
      }),
      sessionStorage: createStorage({})
    });

    const getSession = vi.fn().mockRejectedValue(new Error("Session check timed out."));
    const createClient = vi.fn(() => ({
      auth: {
        getSession,
        signInAnonymously: vi.fn(),
        signInWithOAuth: vi.fn(),
        signOut: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { getStudentAuthEmail, requireStudentSession } = await import("../src/lib/api");

    await expect(getStudentAuthEmail()).resolves.toBe("student@example.edu");
    await expect(requireStudentSession()).resolves.toMatchObject({
      access_token: "stored-access-token",
      user: { email: "student@example.edu" }
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("clears unreadable student auth storage after Supabase recovery confirms no session", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const localStorage = createStorage({
      "alt-assessment.student-auth": "not-json"
    });
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/login?authDebug=1",
        pathname: "/login"
      },
      localStorage,
      sessionStorage: createStorage({})
    });

    const getSession = vi.fn().mockResolvedValue({ data: { session: null } });
    const createClient = vi.fn(() => ({
      auth: {
        getSession,
        signInAnonymously: vi.fn(),
        signInWithOAuth: vi.fn(),
        signOut: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { getStudentAuthEmail } = await import("../src/lib/api");

    await expect(getStudentAuthEmail()).resolves.toBeNull();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("alt-assessment.student-auth")).toBeNull();
  });

  it("clears a stored student session when no email can be resolved", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const localStorage = createStorage({
      "alt-assessment.student-auth": JSON.stringify({
        access_token: "stored-access-token",
        refresh_token: "stored-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          is_anonymous: false
        }
      }),
      "alt-assessment.student-auth-code-verifier": "stale-verifier",
      "alt-assessment.teacher-auth": "teacher-token"
    });
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/login?authDebug=1",
        pathname: "/login"
      },
      localStorage,
      sessionStorage: createStorage({})
    });

    const getSession = vi.fn().mockResolvedValue({ data: { session: null } });
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const createClient = vi.fn(() => ({
      auth: {
        getSession,
        signInAnonymously: vi.fn(),
        signInWithOAuth: vi.fn(),
        signOut
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { getStudentAuthEmail } = await import("../src/lib/api");

    await expect(getStudentAuthEmail()).resolves.toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(localStorage.getItem("alt-assessment.student-auth")).toBeNull();
    expect(localStorage.getItem("alt-assessment.student-auth-code-verifier")).toBeNull();
    expect(localStorage.getItem("alt-assessment.teacher-auth")).toBe("teacher-token");
  });

  it("recovers an expired stored student session through Supabase getSession", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const localStorage = createStorage({
      "alt-assessment.student-auth": JSON.stringify({
        access_token: "expired-access-token",
        refresh_token: "stored-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) - 3600,
        user: {
          email: "student@example.edu",
          is_anonymous: false
        }
      }),
      "alt-assessment.student-auth-code-verifier": "expired-verifier"
    });
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/login?authDebug=1",
        pathname: "/login"
      },
      localStorage,
      sessionStorage: createStorage({})
    });

    const refreshedSession = {
      access_token: "refreshed-access-token",
      refresh_token: "refreshed-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {
        email: "student@example.edu",
        is_anonymous: false
      }
    };
    const getSession = vi.fn().mockResolvedValue({ data: { session: refreshedSession } });
    const createClient = vi.fn(() => ({
      auth: {
        getSession,
        signInAnonymously: vi.fn(),
        signInWithOAuth: vi.fn(),
        signOut: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { getStudentAuthEmail } = await import("../src/lib/api");

    await expect(getStudentAuthEmail()).resolves.toBe("student@example.edu");
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("alt-assessment.student-auth")).not.toBeNull();
    expect(localStorage.getItem("alt-assessment.student-auth-code-verifier")).toBe("expired-verifier");
  });

  it("clears leftover student OAuth helper storage even without a stored session", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const localStorage = createStorage({
      "alt-assessment.student-auth-code-verifier": "stale-verifier"
    });
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/login?authDebug=1",
        pathname: "/login"
      },
      localStorage,
      sessionStorage: createStorage({})
    });

    const getSession = vi.fn().mockResolvedValue({ data: { session: null } });
    const createClient = vi.fn(() => ({
      auth: {
        getSession,
        signInAnonymously: vi.fn(),
        signInWithOAuth: vi.fn(),
        signOut: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { getStudentAuthEmail } = await import("../src/lib/api");

    await expect(getStudentAuthEmail()).resolves.toBeNull();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("alt-assessment.student-auth-code-verifier")).toBeNull();
  });

  it("uses a stored access-token email when the stored session user object is unavailable", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const token = createJwtWithEmail("jwt-student@example.edu");
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/login",
        pathname: "/login"
      },
      localStorage: createStorage({
        "alt-assessment.student-auth": JSON.stringify({
          access_token: token,
          refresh_token: "stored-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600
        })
      }),
      sessionStorage: createStorage({}),
      atob: (value: string) => Buffer.from(value, "base64").toString("utf8")
    });

    const getSession = vi.fn().mockRejectedValue(new Error("Session check timed out."));
    const createClient = vi.fn(() => ({
      auth: {
        getSession,
        signInAnonymously: vi.fn(),
        signInWithOAuth: vi.fn(),
        signOut: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { getStudentAuthEmail } = await import("../src/lib/api");

    await expect(getStudentAuthEmail()).resolves.toBe("jwt-student@example.edu");
    expect(getSession).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("alt-assessment.student-auth")).not.toBeNull();
  });

  it("uses Google identity metadata when the stored session has no direct user email", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/login",
        pathname: "/login"
      },
      localStorage: createStorage({
        "alt-assessment.student-auth": JSON.stringify({
          access_token: "stored-access-token",
          refresh_token: "stored-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            is_anonymous: false,
            identities: [
              {
                provider: "google",
                identity_data: {
                  email: "identity-student@example.edu"
                }
              }
            ]
          }
        })
      }),
      sessionStorage: createStorage({})
    });

    const getSession = vi.fn().mockRejectedValue(new Error("Session check timed out."));
    const createClient = vi.fn(() => ({
      auth: {
        getSession,
        signInAnonymously: vi.fn(),
        signInWithOAuth: vi.fn(),
        signOut: vi.fn()
      }
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { getStudentAuthEmail } = await import("../src/lib/api");

    await expect(getStudentAuthEmail()).resolves.toBe("identity-student@example.edu");
    expect(getSession).not.toHaveBeenCalled();
  });
});

function createStorage(values: Record<string, string>) {
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

function createJwtWithEmail(email: string): string {
  const header = toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify({ email }));
  return `${header}.${payload}.signature`;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
