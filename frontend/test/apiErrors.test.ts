import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiConnectionError, ApiRequestError, isRetryableApiError, publicApiFetch } from "../src/lib/api";

describe("api error parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves structured worker error code and details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        error: "Attempt has already been submitted",
        code: "already_submitted",
        details: { attemptId: "attempt-1" }
      }), {
        status: 409,
        headers: { "Content-Type": "application/json" }
      })
    );

    try {
      await publicApiFetch("/mock");
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      const apiError = error as ApiRequestError;
      expect(apiError.status).toBe(409);
      expect(apiError.message).toBe("Attempt has already been submitted");
      expect(apiError.code).toBe("already_submitted");
      expect(apiError.details).toEqual({ attemptId: "attempt-1" });
    }
  });

  it("falls back to generic message when error payload is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 500,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(publicApiFetch("/mock")).rejects.toMatchObject({
      status: 500,
      message: "Request failed: 500",
      code: undefined,
      details: undefined
    });
  });

  it("makes browser connection failures recoverable without displaying Failed to fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await publicApiFetch("/mock").catch(error => error);
    expect(error).toBeInstanceOf(ApiConnectionError);
    if (!(error instanceof ApiConnectionError)) throw new Error("Expected a recoverable connection error");
    expect(error.message).toBe("Could not connect to the server. Check your connection and try again.");
    expect(isRetryableApiError(error)).toBe(true);
  });

  it("retries temporary server failures but stops for auth, access and lifecycle errors", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) expect(isRetryableApiError(new ApiRequestError("Temporary", status))).toBe(true);
    for (const status of [400, 401, 403, 404, 409]) expect(isRetryableApiError(new ApiRequestError("Denied", status))).toBe(false);
    expect(isRetryableApiError(new Error("Sign in with Google to continue."))).toBe(false);
  });
});
