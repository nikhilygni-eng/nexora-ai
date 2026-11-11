import { defineConfig } from "@playwright/test";

const PORT = 3400;
const sandbox = process.env.DEMO_MODE === "sandbox";

/**
 * Demo-video recorder (tests/demo). Not part of the test suite.
 * 1600×810 CSS pixels at 1.2× device scale = 1920×972 frames (crisp UI text); the encoder adds a
 * 108 px caption band underneath for a 1920×1080 video.
 */
export default defineConfig({
  testDir: "tests/demo",
  timeout: 10 * 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1600, height: 810 },
    deviceScaleFactor: 1.2,
    trace: "off",
    video: "off",
  },
  webServer: {
    command: `rm -rf data/demo.db* && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_PASSCODE: process.env.DEMO_PASSCODE ?? "demo-passcode",
      DATABASE_PATH: "./data/demo.db",
      DEMO_AUTOSEED: "true",
      ...(sandbox
        ? {
            PAYPAL_MODE: "sandbox",
            AI_PROVIDER: "gemini",
            AI_MODEL: process.env.AI_MODEL || "gemini-3.5-flash-lite",
            AI_THINKING_LEVEL: "low",
            AI_MAX_RPM: "14",
          }
        : { PAYPAL_MODE: "mock", AI_PROVIDER: "mock", NEXORA_ALLOW_MOCKS: "true", AI_MOCK_LATENCY_MS: "1800" }),
    },
  },
});
