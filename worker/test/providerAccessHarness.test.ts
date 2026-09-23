import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

describe("provider workflow harness", () => {
  it("resolves Worker dependencies before requesting a secret or making any API call", () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    const script = fileURLToPath(new URL("../scripts/check-provider-access.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script], { env, encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Provider secret is not configured");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(result.stdout).toBe("");
  });
});
