import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/Causalyst/",
  plugins: [react()],
  build: { manifest: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  },
  test: {
    environment: "node",
    environmentOptions: {
      jsdom: {
        url: "http://127.0.0.1:5173/"
      }
    }
  }
});
