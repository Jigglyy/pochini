import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for the UI's pure helpers (src/**/*.test.ts). They run in
// milliseconds; the e2e suite covers the screens against the real app.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    setupFiles: ["src/test/setup.ts"],
  },
});
