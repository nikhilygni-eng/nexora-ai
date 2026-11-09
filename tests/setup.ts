import { beforeEach } from "vitest";
import { openDatabase, setDbForTests } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { resetMockPayPal } from "@/lib/paypal/mock";
import { setPayPalFetcherForTests } from "@/lib/paypal";
import { setAIProviderForTests } from "@/lib/ai";
import { resetRateLimits } from "@/lib/ratelimit";

beforeEach(() => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    PAYPAL_MODE: "mock",
    PAYPAL_BASE_URL: "https://api-m.sandbox.paypal.com",
    AI_PROVIDER: "mock",
    APP_PASSCODE: "test-passcode",
    DATABASE_PATH: ":memory:",
  });
  delete process.env.PAYPAL_ALLOW_LIVE;
  resetEnvCache();
  setDbForTests(openDatabase(":memory:"));
  resetMockPayPal();
  setPayPalFetcherForTests(undefined);
  setAIProviderForTests(undefined);
  resetRateLimits();
});
