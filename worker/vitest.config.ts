import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
  plugins: [
    {
      name: "worker-text-modules",
      enforce: "pre",
      load(id) {
        const [path] = id.split("?");
        if (!path.endsWith(".txt")) return null;
        return `export default ${JSON.stringify(readFileSync(path, "utf8"))};`;
      }
    }
  ]
});
