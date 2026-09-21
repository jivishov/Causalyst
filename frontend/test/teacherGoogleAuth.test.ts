import { afterEach, describe, expect, it, vi } from "vitest";

describe("teacher Google auth", () => {
  afterEach(() => {
    vi.doUnmock("@supabase/supabase-js");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("starts Google OAuth with the teacher redirect and account chooser", async () => {
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

    const { signInTeacherWithGoogle } = await import("../src/lib/api");
    await signInTeacherWithGoogle();

    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://school.example/teacher",
        queryParams: { prompt: "select_account" }
      }
    });
  });

  it("exchanges teacher callback codes with the isolated teacher client", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const studentExchange = vi.fn();
    const teacherSession = {
      access_token: "teacher-token",
      refresh_token: "teacher-refresh",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { email: "teacher@example.edu" }
    };
    const teacherExchange = vi.fn().mockResolvedValue({
      data: { session: teacherSession, user: teacherSession.user, redirectType: null },
      error: null
    });
    const createClient = vi.fn()
      .mockReturnValueOnce({ auth: { exchangeCodeForSession: studentExchange, setSession: vi.fn() } })
      .mockReturnValueOnce({ auth: { exchangeCodeForSession: teacherExchange, setSession: vi.fn() } });
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/teacher?code=teacher-code&state=provider-state",
        origin: "https://school.example",
        pathname: "/teacher"
      },
      history: { replaceState }
    });

    const { completeTeacherAuthCallbackIfPresent } = await import("../src/lib/supabase");
    await expect(completeTeacherAuthCallbackIfPresent()).resolves.toMatchObject({
      access_token: "teacher-token"
    });

    expect(studentExchange).not.toHaveBeenCalled();
    expect(teacherExchange).toHaveBeenCalledWith("teacher-code");
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://school.example/teacher");
  });
});
