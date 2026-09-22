import { defineConfig } from "vitest/config";
import base from "./vitest.config";
export default defineConfig({
  ...base,
  test: { include: ["integration/**/*.test.ts"], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false }
});
