import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_AUDIO_MAX_BYTES, DEFAULT_WRITING_ACCEPTED_MIME, DEFAULT_WRITING_MAX_BYTES } from "@alt-assessment/shared";
import type { Env } from "../lib/env";
import { signUploadToken, verifyPreviewToken, verifyUploadToken } from "../lib/crypto";
import { requireArtifact, requireAttempt } from "../lib/db";
import { corsHeaders, HttpError, getOptionalString, getRequiredString, readJson, safeFilename } from "../lib/http";
import { deleteOpenAIFile, openaiClient } from "../lib/openai";

const bucketByKind = {
  audio: "audio",
  writing: "writing",
  "simulation-derived": "simulation-derived",
  "simulation-sketch": "simulation-sketch"
} as const;

export async function createUploadToken(request: Request, env: Env, db: SupabaseClient, userId: string) {
  const body = await readJson<Record<string, unknown>>(request);
  const attemptId = getRequiredString(body, "attemptId");
  const kind = getRequiredString(body, "kind") as keyof typeof bucketByKind;
  const mimeType = getRequiredString(body, "mimeType");
  const filename = safeFilename(getOptionalString(body, "filename") ?? "artifact.bin");
  const byteSize = Number(body.byteSize ?? 0);
  if (!bucketByKind[kind]) throw new HttpError(400, "Unsupported artifact kind");
  if (!Number.isFinite(byteSize) || !Number.isInteger(byteSize) || byteSize <= 0) {
    throw new HttpError(400, "Invalid byte size");
  }

  const { assessment } = await requireAttempt(db, userId, attemptId);
  switch (kind) {
    case "audio":
      if (assessment.type !== "voice") {
        throw new HttpError(400, "Attempt is not a voice assessment");
      }
      validateAudioReservation(assessment.config, byteSize);
      break;
    case "writing":
      if (assessment.type !== "writing") {
        throw new HttpError(400, "Attempt is not a writing assessment");
      }
      validateWritingReservation(assessment.config, mimeType, byteSize);
      break;
    case "simulation-derived":
    case "simulation-sketch":
      throw new HttpError(400, "Simulation artifacts are generated server-side");
  }

  const artifactId = crypto.randomUUID();
  const storageKey = `${kind}/${userId}/${attemptId}/${artifactId}-${filename}`;
  const { error } = await db.from("attempt_artifacts").insert({
    id: artifactId,
    attempt_id: attemptId,
    student_id: userId,
    kind,
    bucket: bucketByKind[kind],
    storage_key: storageKey,
    mime_type: mimeType,
    byte_size: byteSize,
    original_filename: filename,
    upload_state: "pending"
  });
  if (error) throw new HttpError(500, "Failed to create artifact", error.message);

  const uploadToken = await signUploadToken(artifactId, userId, env);
  return {
    artifactId,
    uploadUrl: `${new URL(request.url).origin}/api/artifacts/${artifactId}/upload`,
    uploadToken
  };
}

function validateWritingReservation(config: Record<string, unknown>, mimeType: string, byteSize: number): void {
  const normalizedMimeType = normalizeMimeType(mimeType);
  const configuredAcceptedMime = normalizeMimeList(
    Array.isArray(config.acceptedMime)
      ? config.acceptedMime.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [...DEFAULT_WRITING_ACCEPTED_MIME]
  );
  const acceptedMime = configuredAcceptedMime.length > 0
    ? configuredAcceptedMime
    : normalizeMimeList([...DEFAULT_WRITING_ACCEPTED_MIME]);
  const maxBytes = typeof config.maxBytes === "number" && Number.isFinite(config.maxBytes) && config.maxBytes > 0
    ? Math.round(config.maxBytes)
    : DEFAULT_WRITING_MAX_BYTES;

  if (!acceptedMime.includes(normalizedMimeType)) {
    throw new HttpError(400, `Writing uploads must use one of: ${acceptedMime.join(", ")}`);
  }
  if (byteSize > maxBytes) {
    throw new HttpError(400, `Writing upload exceeds max size of ${maxBytes} bytes`);
  }
}

function validateAudioReservation(config: Record<string, unknown> | null | undefined, byteSize: number): void {
  const configuredMaxBytes = config?.maxAudioBytes;
  const maxBytes = typeof configuredMaxBytes === "number" && Number.isFinite(configuredMaxBytes) && configuredMaxBytes > 0
    ? Math.round(configuredMaxBytes)
    : DEFAULT_AUDIO_MAX_BYTES;
  if (byteSize > maxBytes) {
    throw new HttpError(400, `Audio upload exceeds max size of ${maxBytes} bytes`);
  }
}

function normalizeMimeList(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = normalizeMimeType(value);
    if (!normalized) continue;
    unique.add(normalized);
  }
  return Array.from(unique);
}

function normalizeMimeType(value: string): string {
  return value.trim().toLowerCase();
}

export async function uploadArtifact(request: Request, env: Env, db: SupabaseClient, userId: string, artifactId: string) {
  const uploadToken = request.headers.get("X-Upload-Token") ?? "";
  if (!(await verifyUploadToken(artifactId, userId, uploadToken, env))) {
    throw new HttpError(403, "Invalid upload token");
  }

  const artifact = await requireArtifact(db, userId, artifactId);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== artifact.byte_size) {
    throw new HttpError(400, "Uploaded byte size does not match artifact reservation");
  }

  const { error: uploadError } = await db.storage
    .from(artifact.bucket)
    .upload(artifact.storage_key, bytes, { contentType: artifact.mime_type, upsert: true });
  if (uploadError) throw new HttpError(500, "Failed to upload artifact", uploadError.message);

  const { error: updateError } = await db
    .from("attempt_artifacts")
    .update({
      upload_state: "uploaded",
      byte_size: bytes.byteLength,
      // Force fresh provider upload if the artifact is re-uploaded.
      openai_file_id: null
    })
    .eq("id", artifactId)
    .eq("student_id", userId);
  if (updateError) throw new HttpError(500, "Failed to finalize artifact", updateError.message);

  if (artifact.openai_file_id) {
    await deleteOpenAIFileBestEffort(env, artifact.openai_file_id, artifact.id);
  }

  return { artifactId, state: "uploaded" };
}

export async function previewArtifact(request: Request, env: Env, db: SupabaseClient, userId: string, artifactId: string): Promise<Response> {
  const previewToken = new URL(request.url).searchParams.get("previewToken") ?? "";
  if (!(await verifyPreviewToken(artifactId, userId, previewToken, env))) {
    throw new HttpError(403, "Invalid preview token");
  }

  const artifact = await requireArtifact(db, userId, artifactId);
  if ((artifact.kind !== "simulation-derived" && artifact.kind !== "simulation-sketch") || artifact.upload_state !== "uploaded") {
    throw new HttpError(400, "Simulation artifact is not ready");
  }

  const { data, error } = await downloadStoredArtifactWithRetry(db, artifact.bucket, artifact.storage_key);
  if (error || !data) throw new HttpError(500, "Failed to download simulation artifact", error?.message);

  return new Response(await data.arrayBuffer(), {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": artifact.mime_type || "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function downloadStoredArtifactWithRetry(
  db: SupabaseClient,
  bucket: string,
  storageKey: string
): Promise<{ data: Blob | null; error: { message?: string } | null }> {
  let lastError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await db.storage.from(bucket).download(storageKey);
    if (data && !error) return { data, error: null };
    lastError = error;
    if (attempt < 3) await delay(125 * (attempt + 1));
  }
  return { data: null, error: lastError };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteOpenAIFileBestEffort(env: Env, fileId: string, artifactId: string): Promise<void> {
  try {
    await deleteOpenAIFile(openaiClient(env.OPENAI_API_KEY), fileId);
  } catch (error) {
    console.error("Failed to delete stale OpenAI file handle", {
      artifactId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
