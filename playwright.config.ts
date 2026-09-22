import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", timeout: 20000, workers: 1,
  use: { baseURL: "http://127.0.0.1:5173/Causalyst/", headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } },
  webServer: {
    command: "npm run dev --workspace frontend", url: "http://127.0.0.1:5173/Causalyst/", reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: "https://auth.test", VITE_SUPABASE_ANON_KEY: "synthetic-browser-fixture", VITE_WORKER_URL: "http://127.0.0.1:8787" }
  }
});
