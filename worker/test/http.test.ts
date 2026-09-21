import { describe, expect, it } from "vitest";
import type { Env } from "../src/lib/env";
import { corsHeaders, HttpError, toErrorResponse } from "../src/lib/http";

const env: Env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  OPENAI_API_KEY: "openai-key",
  PIN_PEPPER: "dev-pepper",
  ALLOWED_ORIGINS: "https://app.test"
};

describe("toErrorResponse", () => {
  it("includes structured lifecycle code when provided", async () => {
    const response = toErrorResponse(
      new Request("https://worker.test/api/mock"),
      env,
      new HttpError(409, "Attempt has already been submitted", undefined, "already_submitted")
    );
    const payload = await response.json() as { error: string; code?: string; details?: unknown };

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: "Attempt has already been submitted",
      code: "already_submitted"
    });
  });

  it("drops unknown structured codes outside the shared lifecycle contract", async () => {
    const response = toErrorResponse(
      new Request("https://worker.test/api/mock"),
      env,
      new HttpError(409, "Validation failed", { requiresConfirmation: true }, "unknown_code")
    );
    const payload = await response.json() as { error: string; code?: string; details?: unknown };

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: "Validation failed",
      details: { requiresConfirmation: true }
    });
  });

  it("keeps safe validation details for expected client errors", async () => {
    const response = toErrorResponse(
      new Request("https://worker.test/api/mock"),
      env,
      new HttpError(409, "Validation failed", { requiresConfirmation: true })
    );
    const payload = await response.json() as { error: string; details?: unknown };

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: "Validation failed",
      details: { requiresConfirmation: true }
    });
  });

  it("redacts sensitive details from client-error responses", async () => {
    const response = toErrorResponse(
      new Request("https://worker.test/api/mock"),
      env,
      new HttpError(409, "Validation failed", { storage_key: "writing/user/attempt/file.png" }, "final_required")
    );
    const payload = await response.json() as { error: string; code?: string; details?: unknown };

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: "Validation failed", code: "final_required" });
  });

  it("never returns internal details for server errors", async () => {
    const response = toErrorResponse(
      new Request("https://worker.test/api/mock"),
      env,
      new HttpError(500, "Failed to load assignment", "column foo does not exist")
    );
    const payload = await response.json() as { error: string; details?: unknown };

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Failed to load assignment" });
  });

  it("redacts sensitive message text when error text includes backend internals", async () => {
    const response = toErrorResponse(
      new Request("https://worker.test/api/mock"),
      env,
      new HttpError(500, "DB error: column storage_key does not exist", null)
    );
    const payload = await response.json() as { error: string; details?: unknown };

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Internal server error" });
  });

  it("keeps the public simulation job storage setup message for server errors", async () => {
    const response = toErrorResponse(
      new Request("https://worker.test/api/mock"),
      env,
      new HttpError(
        503,
        "Simulation generation job storage is not ready. Apply the latest Supabase database update and try again.",
        "Could not find the table 'public.simulation_generation_jobs' in the schema cache"
      )
    );
    const payload = await response.json() as { error: string; details?: unknown };

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: "Simulation generation job storage is not ready. Apply the latest Supabase database update and try again."
    });
  });

  it("redacts migration and RPC internals from client-error messages", async () => {
    const response = toErrorResponse(
      new Request("https://worker.test/api/mock"),
      env,
      new HttpError(409, "Student Google login requires database migration 0014_student_google_login.sql for claim_student_google_login")
    );
    const payload = await response.json() as { error: string; details?: unknown };

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: "Request could not be processed" });
  });

  it("allows the public lifecycle migration-required response", async () => {
    const response = toErrorResponse(
      new Request("https://worker.test/api/mock"),
      env,
      new HttpError(
        409,
        "Attempt lifecycle requires a database update before submissions can run.",
        undefined,
        "attempt_lifecycle_migration_required"
      )
    );
    const payload = await response.json() as { error: string; code?: string; details?: unknown };

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: "Attempt lifecycle requires a database update before submissions can run.",
      code: "attempt_lifecycle_migration_required"
    });
  });
});

describe("corsHeaders", () => {
  it("does not reflect request origins in production when ALLOWED_ORIGINS is missing", () => {
    const headers = new Headers(corsHeaders(
      new Request("https://worker.test/api/mock", { headers: { Origin: "https://evil.test" } }),
      { ...env, APP_ENV: "production", ALLOWED_ORIGINS: "" }
    ));

    expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("keeps development loopback behavior when ALLOWED_ORIGINS is missing", () => {
    const headers = new Headers(corsHeaders(
      new Request("https://worker.test/api/mock", { headers: { Origin: "http://localhost:5173" } }),
      { ...env, APP_ENV: "development", ALLOWED_ORIGINS: undefined }
    ));

    expect(headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });
});
