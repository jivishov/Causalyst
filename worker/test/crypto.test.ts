import { describe, expect, it } from "vitest";
import { hashPin, signPreviewToken, signUploadToken, verifyPreviewToken, verifyUploadToken } from "../src/lib/crypto";

const env = { PIN_PEPPER: "dev-pepper" };

describe("crypto helpers", () => {
  it("hashes PINs deterministically with a pepper", async () => {
    await expect(hashPin("2468", env)).resolves.toMatch(/^[a-f0-9]{64}$/);
    expect(await hashPin("2468", env)).toBe(await hashPin("2468", env));
  });

  it("verifies upload tokens", async () => {
    const token = await signUploadToken("artifact", "student", env);
    await expect(verifyUploadToken("artifact", "student", token, env)).resolves.toBe(true);
    await expect(verifyUploadToken("artifact", "other", token, env)).resolves.toBe(false);
  });

  it("uses different scopes for upload and preview tokens", async () => {
    const uploadToken = await signUploadToken("artifact", "student", env);
    const previewToken = await signPreviewToken("artifact", "student", env);

    expect(uploadToken).not.toBe(previewToken);
    await expect(verifyPreviewToken("artifact", "student", previewToken, env)).resolves.toBe(true);
    await expect(verifyPreviewToken("artifact", "student", uploadToken, env)).resolves.toBe(false);
  });
});
