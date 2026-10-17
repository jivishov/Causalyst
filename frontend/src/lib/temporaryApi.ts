import { teacherSupabase } from "./supabase";
const teacherBase =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ||
  "http://localhost:8787";
const guestBase =
  (import.meta.env.VITE_GUEST_API_ORIGIN as string | undefined) ||
  "https://api.explain.az";
export class TemporaryRequestError extends Error {
  constructor(public code: string) {
    super(code.replaceAll("_", " "));
  }
}
export async function temporaryApi<T>(
  path: string,
  input?: unknown,
  guest = false,
  csrf?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (guest && csrf) headers["X-Explain-CSRF"] = csrf;
  if (!guest) {
    const { data } = await teacherSupabase.auth.getSession();
    if (!data.session) throw new TemporaryRequestError("ACCESS_REVOKED");
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const response = await fetch(`${guest ? guestBase : teacherBase}${path}`, {
    method: input === undefined ? "GET" : "POST",
    headers,
    credentials: guest ? "include" : "omit",
    cache: "no-store",
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok)
    throw new TemporaryRequestError(
      typeof data.code === "string" ? data.code : "UNAVAILABLE",
    );
  return data as T;
}
