import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, publicApiFetch } from "../src/lib/api";

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
});
