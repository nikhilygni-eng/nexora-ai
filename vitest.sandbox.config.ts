import { defineConfig } from "vitest/config";
import path from "node:path";

/** Opt-in config for the real PayPal Sandbox test only. */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: { environment: "node", include: ["tests/sandbox/**/*.test.ts"] },
});
