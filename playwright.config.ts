import { defineConfig } from "@playwright/test";

const PORT = 3211;

/** E2E runs against a production build with mock PayPal + scripted AI (both visibly labeled in the UI). */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  webServer: {
    command: `rm -rf data/e2e.db* && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PAYPAL_MODE: "mock",
      AI_PROVIDER: "mock",
      NEXORA_ALLOW_MOCKS: "true",
      APP_PASSCODE: "e2e-passcode",
      DATABASE_PATH: "./data/e2e.db",
    },
  },
});
