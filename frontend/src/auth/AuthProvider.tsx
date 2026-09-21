import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { authConfig, isSupabaseConfigured } from "./authConfig";
import { signInWithGoogle as startGoogleSignIn, signOutOfGoogle, withTimeout } from "./authActions";
import {
  completeAuthCallbackIfPresent,
  getCurrentAuthCallbackSnapshot,
  hasStoredAuthState,
  isAuthCallbackSnapshot,
  isUsableSession,
  readAuthSessionFallback,
  rememberAuthSession,
  resetAuthState
} from "./authCallback";
import { authSupabase } from "./supabaseClient";

export type AuthStatus = "checking" | "signed_out" | "authenticated" | "error";
export type AuthStep =
  | "idle"
  | "checking_existing_session"
  | "completing_google_callback"
  | "reading_google_session"
  | "resetting";

interface AuthContextValue {
  status: AuthStatus;
  step: AuthStep;
  session: Session | null;
  user: User | null;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resetAuth: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? "checking" : "error");
  const [step, setStep] = useState<AuthStep>(isSupabaseConfigured ? "checking_existing_session" : "idle");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(isSupabaseConfigured ? null : "Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  const activeOperationRef = useRef(0);
  const mountedRef = useRef(true);
  const statusRef = useRef<AuthStatus>(status);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const beginOperation = useCallback(() => {
    activeOperationRef.current += 1;
    return activeOperationRef.current;
  }, []);

  const isCurrentOperation = useCallback((operationId: number) => {
    return mountedRef.current && activeOperationRef.current === operationId;
  }, []);

  const applyChecking = useCallback((nextStep: AuthStep) => {
    statusRef.current = "checking";
    setStatus("checking");
    setStep(nextStep);
    setError(null);
  }, []);

  const applySignedOut = useCallback((nextError: string | null = null) => {
    statusRef.current = nextError ? "error" : "signed_out";
    setStatus(nextError ? "error" : "signed_out");
    setStep("idle");
    setSession(null);
    setError(nextError);
  }, []);

  const applyAuthenticated = useCallback((nextSession: Session) => {
    rememberAuthSession(nextSession);
    statusRef.current = "authenticated";
    setStatus("authenticated");
    setStep("idle");
    setSession(nextSession);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const operationId = beginOperation();
    const snapshot = getCurrentAuthCallbackSnapshot();
    const isCallback = isAuthCallbackSnapshot(snapshot);
    applyChecking(isCallback ? "completing_google_callback" : "checking_existing_session");

    try {
      if (!isSupabaseConfigured) {
        if (isCurrentOperation(operationId)) {
          applySignedOut("Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
        }
        return;
      }

      if (isCallback) {
        await withTimeout(
          completeAuthCallbackIfPresent(snapshot),
          authConfig.operationTimeoutMs,
          "Google sign-in timed out."
        );
      }

      if (!isCurrentOperation(operationId)) return;
      applyChecking("reading_google_session");

      const currentSession = await readCurrentSession();
      if (!isCurrentOperation(operationId)) return;

      if (currentSession) {
        applyAuthenticated(currentSession);
        return;
      }

      applySignedOut(isCallback ? "Google sign-in returned to the app, but no Supabase session was stored. Use Reset sign-in and try again." : null);
    } catch (err) {
      if (!isCurrentOperation(operationId)) return;
      applySignedOut(err instanceof Error && err.message.trim() ? err.message : "Google sign-in could not be completed.");
    }
  }, [applyAuthenticated, applyChecking, applySignedOut, beginOperation, isCurrentOperation]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      if (statusRef.current === "checking") return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refresh().catch(() => undefined);
      }, 0);
    };
    const { data } = authSupabase.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
        scheduleRefresh();
      }
    });
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      data.subscription.unsubscribe();
    };
  }, [refresh]);

  const signInWithGoogle = useCallback(async () => {
    await startGoogleSignIn();
  }, []);

  const resetAuth = useCallback(async () => {
    const operationId = beginOperation();
    applyChecking("resetting");
    try {
      if (isSupabaseConfigured) {
        await signOutOfGoogle();
      }
    } finally {
      resetAuthState();
      if (isCurrentOperation(operationId)) {
        applySignedOut();
      }
    }
  }, [applyChecking, applySignedOut, beginOperation, isCurrentOperation]);

  const signOut = useCallback(async () => {
    await resetAuth();
  }, [resetAuth]);

  const value = useMemo(
    () => ({
      status,
      step,
      session,
      user: session?.user ?? null,
      error,
      signInWithGoogle,
      signOut,
      resetAuth,
      refresh
    }),
    [status, step, session, error, signInWithGoogle, signOut, resetAuth, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

async function readCurrentSession(): Promise<Session | null> {
  const fallback = readAuthSessionFallback();
  if (fallback) return fallback;
  if (!hasStoredAuthState()) return null;

  const { data } = await withTimeout(
    authSupabase.auth.getSession(),
    authConfig.operationTimeoutMs,
    "Session check timed out."
  );
  const session = data.session ?? null;
  if (session && isUsableSession(session)) {
    rememberAuthSession(session);
    return session;
  }
  return null;
}
