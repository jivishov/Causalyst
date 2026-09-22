import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http";

export async function contentDigest(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const data = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function completeArtifact(db: SupabaseClient, userId: string, artifactId: string, hash: string): Promise<void> {
  const { error } = await db.rpc("complete_artifact_upload", {
    p_user_id: userId, p_artifact_id: artifactId, p_sha256: hash
  });
  if (error) throw new HttpError(error.code === "23514" ? 409 : 500, "Could not complete upload; the attempt may already be submitted", error.message);
}
