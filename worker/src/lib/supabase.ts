import { createClient } from "@supabase/supabase-js";
import type { AppDatabaseClient, Database } from "./database";
import type { Env } from "./env";
import { HttpError } from "./http";

export function serviceSupabase(env: Env): AppDatabaseClient {
  const serviceRoleKey = normalizeSecret(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    throw new HttpError(500, "Worker SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createClient<Database>(env.SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function normalizeSecret(value: string | undefined, keyName: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";

  // Common local mistake: KEY=KEY=actual-token
  const prefix = `${keyName}=`;
  if (raw.startsWith(prefix)) {
    return raw.slice(prefix.length).trim();
  }
  return raw;
}
