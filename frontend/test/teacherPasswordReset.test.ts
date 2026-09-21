import { afterEach, describe, expect, it, vi } from "vitest";

describe("teacher password reset", () => {
  afterEach(() => {
    vi.doUnmock("@supabase/supabase-js");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("sends teacher password reset emails to the teacher reset route", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("window", {
      location: {
        origin: "https://school.example",
        href: "https://school.example/teacher",
        pathname: "/teacher"
      }
    });

    const studentResetPasswordForEmail = vi.fn();
    const teacherResetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });
    let clientIndex = 0;
    const createClient = vi.fn(() => {
      clientIndex += 1;
      return {
        auth: {
          resetPasswordForEmail: clientIndex === 1 ? studentResetPasswordForEmail : teacherResetPasswordForEmail
        }
      };
    });
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { requestTeacherPasswordReset } = await import("../src/lib/api");
    await requestTeacherPasswordReset({ email: "Teacher@Example.edu " });

    expect(studentResetPasswordForEmail).not.toHaveBeenCalled();
    expect(teacherResetPasswordForEmail).toHaveBeenCalledWith("teacher@example.edu", {
      redirectTo: "https://school.example/teacher/reset-password"
    });
  });

  it("exchanges teacher recovery callbacks with the teacher auth client", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: {
        href: "https://school.example/teacher/reset-password?code=recovery-code&state=provider-state",
        pathname: "/teacher/reset-password"
      },
      history: { replaceState }
    });

    const studentExchangeCodeForSession = vi.fn();
    const teacherExchangeCodeForSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: "teacher-token" } },
      error: null
    });
    let clientIndex = 0;
    const createClient = vi.fn(() => {
      clientIndex += 1;
      return {
        auth: {
          exchangeCodeForSession: clientIndex === 1 ? studentExchangeCodeForSession : teacherExchangeCodeForSession
        }
      };
    });
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    const { completeTeacherPasswordRecovery } = await import("../src/lib/api");
    await completeTeacherPasswordRecovery();

    expect(studentExchangeCodeForSession).not.toHaveBeenCalled();
    expect(teacherExchangeCodeForSession).toHaveBeenCalledWith("recovery-code");
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://school.example/teacher/reset-password");
  });
});
