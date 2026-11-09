import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for plain functions in src/lib (no browser, no database). Run with: npm test
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" throws outside Next.js's server build; in tests the guarded files run in Node anyway.
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.js", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
  },
});
