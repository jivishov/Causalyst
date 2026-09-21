// @vitest-environment jsdom

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

describe("Google OAuth auth module", () => {
  afterEach(() => {
    vi.doUnmock("@supabase/supabase-js");
    vi.doUnmock("../src/auth/AuthProvider");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "http://127.0.0.1:5173/");
  });

  it("creates the Supabase client with PKCE and manual callback handling", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const createClient = vi.fn((url: string, key: string, options: unknown) => ({ url, key, options }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));

    await import("../src/auth/supabaseClient");

    expect(createClient).toHaveBeenCalledWith("https://project.supabase.co", "anon-key", {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        flowType: "pkce",
        detectSessionInUrl: false,
        storageKey: "google-oauth-template.auth"
      }
    });
  });

  it("starts Google OAuth with the configured callback redirect", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    window.history.replaceState(null, "", "http://127.0.0.1:5173/login");
    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: vi.fn(() => ({
        auth: {
          signInWithOAuth
        }
      }))
    }));

    const { signInWithGoogle } = await import("../src/auth/authActions");
    await signInWithGoogle();

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://127.0.0.1:5173/auth/callback",
        queryParams: { prompt: "select_account" }
      }
    });
  });

  it("does not process callback codes outside the configured callback path", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    window.history.replaceState(null, "", "http://127.0.0.1:5173/login?code=auth-code");
    const exchangeCodeForSession = vi.fn();
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: vi.fn(() => ({
        auth: {
          exchangeCodeForSession,
          setSession: vi.fn()
        }
      }))
    }));

    const { completeAuthCallbackIfPresent } = await import("../src/auth/authCallback");
    await completeAuthCallbackIfPresent();

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("exchanges callback codes and clears callback URL markers", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    window.history.replaceState(null, "", "http://127.0.0.1:5173/auth/callback?code=auth-code&state=provider-state&debug=1");
    window.localStorage.setItem("google-oauth-template.auth-code-verifier", JSON.stringify("pkce-verifier"));
    const session = {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "user-1", email: "user@example.com" }
    };
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: vi.fn(() => ({
        auth: {
          exchangeCodeForSession,
          setSession: vi.fn()
        }
      }))
    }));

    const { completeAuthCallbackIfPresent } = await import("../src/auth/authCallback");
    await expect(completeAuthCallbackIfPresent()).resolves.toMatchObject({ access_token: "access-token" });

    expect(exchangeCodeForSession).toHaveBeenCalledWith("auth-code");
    expect(window.location.href).toBe("http://127.0.0.1:5173/auth/callback?debug=1");
  });

  it("surfaces provider errors and clears callback markers", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    window.history.replaceState(null, "", "http://127.0.0.1:5173/auth/callback?error=access_denied&error_description=Denied");
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: vi.fn(() => ({
        auth: {
          exchangeCodeForSession: vi.fn(),
          setSession: vi.fn()
        }
      }))
    }));

    const { completeAuthCallbackIfPresent } = await import("../src/auth/authCallback");
    await expect(completeAuthCallbackIfPresent()).rejects.toThrow("Google sign-in failed: Denied");

    expect(window.location.href).toBe("http://127.0.0.1:5173/auth/callback");
  });

  it("reports missing PKCE verifier guidance instead of exchanging blindly", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    window.history.replaceState(null, "", "http://127.0.0.1:5173/auth/callback?code=auth-code");
    const exchangeCodeForSession = vi.fn();
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: vi.fn(() => ({
        auth: {
          exchangeCodeForSession,
          setSession: vi.fn()
        }
      }))
    }));

    const { completeAuthCallbackIfPresent } = await import("../src/auth/authCallback");
    await expect(completeAuthCallbackIfPresent()).rejects.toThrow("missing the PKCE verifier");

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("resetAuthState removes only module-owned Supabase auth keys", async () => {
    const removed: string[] = [];
    const storage = createTestStorage({
      "google-oauth-template.auth": "session",
      "google-oauth-template.auth-code-verifier": "verifier",
      "other-app.auth": "keep"
    }, removed);

    const { resetAuthState } = await import("../src/auth/authCallback");
    resetAuthState(storage);

    expect(new Set(removed)).toEqual(new Set([
      "google-oauth-template.auth",
      "google-oauth-template.auth-code-verifier"
    ]));
    expect(storage.remainingKeys()).toEqual(["other-app.auth"]);
  });

  it("AuthGate redirects signed-out users and renders authenticated content", async () => {
    vi.doMock("../src/auth/AuthProvider", () => ({
      useAuth: () => ({ status: "signed_out" })
    }));
    let module = await import("../src/auth/AuthGate");
    const { unmount } = render(
      <MemoryRouter initialEntries={["/private"]}>
        <Routes>
          <Route path="/login" element={<p>login route</p>} />
          <Route path="/private" element={<module.AuthGate><p>secret route</p></module.AuthGate>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("login route")).toBeTruthy();
    unmount();

    vi.resetModules();
    vi.doMock("../src/auth/AuthProvider", () => ({
      useAuth: () => ({ status: "authenticated" })
    }));
    module = await import("../src/auth/AuthGate");
    render(
      <MemoryRouter initialEntries={["/private"]}>
        <Routes>
          <Route path="/private" element={<module.AuthGate><p>secret route</p></module.AuthGate>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("secret route")).toBeTruthy();
  });

  it("keeps the module free of GIS and app-specific identity policy", () => {
    const source = readProjectSource(join(process.cwd(), "src", "auth"));
    expect(source).not.toContain("gsi/client");
    expect(source).not.toContain("google.accounts");
    expect(source).not.toContain("renderButton");
    expect(source).not.toContain("VITE_GOOGLE_CLIENT_ID");
    expect(source).not.toMatch(/teacher|student|TEACHER_SETUP_CODE/i);
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

function readProjectSource(root: string): string {
  let output = "";
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      output += readProjectSource(fullPath);
    } else if (/\.(ts|tsx|css|html)$/.test(entry)) {
      output += `\n${readFileSync(fullPath, "utf8")}`;
    }
  }
  return output;
}
