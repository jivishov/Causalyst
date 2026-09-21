import { isProductionEnv, type Env } from "./env";
import type { StudentLifecycleErrorCode } from "@alt-assessment/shared";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public code?: StudentLifecycleErrorCode | string
  ) {
    super(message);
  }
}

const PUBLIC_DETAIL_STATUSES = new Set([400, 401, 403, 404, 409, 422]);
const STUDENT_LIFECYCLE_ERROR_CODES: ReadonlySet<StudentLifecycleErrorCode> = new Set([
  "same_course_identity_conflict",
  "roster_email_required",
  "roster_email_mismatch",
  "student_login_unavailable",
  "attempt_lifecycle_migration_required",
  "already_submitted",
  "final_published",
  "final_required"
]);
const SENSITIVE_DETAIL_PATTERNS = [
  /pin_hash/i,
  /openai_file_id/i,
  /storage_key/i,
  /raw_response/i,
  /(?:^|[^a-z])file-[a-z0-9]{12,}(?:[^a-z0-9]|$)/i,
  /(?:^|[^a-z])sk-(?:proj|live|test)?-[a-z0-9_-]{20,}/i,
  /supabase.*service.*role/i,
  /service[_-]?role/i,
  /[a-z]:(?:\\\\|\/)+(?:users|documents and settings)(?:\\\\|\/)+/i,
  /(?:audio|writing|simulation-derived)\/[a-z0-9._/-]{8,}/i,
  /\b(?:migration|procedure|function|rpc)\b/i,
  /\b\d{4}_[a-z0-9_]+\.sql\b/i,
  /claim_student_google_login/i,
  /\b(?:sqlstate|postgres|postgrest|pgrst\d+|syntax error|column .* does not exist)\b/i
];

export function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const allowOrigin = resolveAllowedOrigin(origin, allowed, isProductionEnv(env));
  const requestedHeaders = request.headers.get("Access-Control-Request-Headers");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": requestedHeaders || "Authorization,Content-Type,X-Upload-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
  return headers;
}

export function jsonResponse(request: Request, env: Env, body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request, env),
      ...init.headers
    }
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json<T>();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function getRequiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `Missing required field: ${key}`);
  }
  return value.trim();
}

export function getOptionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function safeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 96) || "artifact.bin";
}

export function toErrorResponse(request: Request, env: Env, error: unknown): Response {
  if (error instanceof HttpError) {
    if (error.status >= 500) {
      console.error("HttpError", {
        status: error.status,
        message: error.message,
        details: error.details
      });
    }
    const message = sanitizePublicMessage(error.status, error.message);
    const details = sanitizePublicDetails(error.status, error.details);
    const code = sanitizePublicCode(error.code);
    const body: Record<string, unknown> = { error: message };
    if (code) body.code = code;
    if (details !== undefined) body.details = details;
    return jsonResponse(request, env, body, { status: error.status });
  }
  console.error(error);
  return jsonResponse(request, env, { error: "Internal server error" }, { status: 500 });
}

function sanitizePublicMessage(status: number, message: string): string {
  if (!containsSensitiveText(message)) return message;
  return status >= 500 ? "Internal server error" : "Request could not be processed";
}

function sanitizePublicDetails(status: number, details: unknown): unknown {
  if (details === undefined || details === null) return undefined;
  if (!PUBLIC_DETAIL_STATUSES.has(status)) return undefined;
  const scanText = serializeForScan(details);
  if (containsSensitiveText(scanText)) {
    return undefined;
  }
  return details;
}

function sanitizePublicCode(code: unknown): StudentLifecycleErrorCode | undefined {
  if (typeof code !== "string") return undefined;
  if (!STUDENT_LIFECYCLE_ERROR_CODES.has(code as StudentLifecycleErrorCode)) return undefined;
  return code as StudentLifecycleErrorCode;
}

function containsSensitiveText(value: string): boolean {
  return SENSITIVE_DETAIL_PATTERNS.some((pattern) => pattern.test(value));
}

function serializeForScan(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveAllowedOrigin(origin: string, allowed: string[], failClosed: boolean): string | undefined {
  if (!origin) return allowed[0] ?? (failClosed ? undefined : "*");
  if (allowed.length === 0) return failClosed ? undefined : origin;
  if (allowed.includes(origin)) return origin;
  if (isLoopbackOrigin(origin) && allowed.some(isLoopbackOrigin)) return origin;
  return allowed[0] ?? origin;
}

function isLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1"
    );
  } catch {
    return false;
  }
}
