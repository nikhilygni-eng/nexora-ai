import { describe, expect, it } from "vitest";
import { getEnv, getSetupStatus, resetEnvCache } from "@/lib/env";
import { createSessionToken, verifySessionToken } from "@/lib/auth";

describe("env guard", () => {
  it("refuses a non-sandbox PayPal base URL", () => {
    process.env.PAYPAL_BASE_URL = "https://api-m.paypal.com";
    resetEnvCache();
    expect(() => getEnv()).toThrow(/Refusing to start/);
    process.env.PAYPAL_ALLOW_LIVE = "true";
    resetEnvCache();
    expect(getEnv().PAYPAL_BASE_URL).toBe("https://api-m.paypal.com");
  });

  it("reports missing setup without exposing values", () => {
    Object.assign(process.env, { PAYPAL_MODE: "sandbox", AI_PROVIDER: "freellmapi", PAYPAL_CLIENT_ID: "", PAYPAL_CLIENT_SECRET: "super-secret", FREELLMAPI_API_KEY: "" });
    resetEnvCache();
    const s = getSetupStatus();
    expect(s.paypalReady).toBe(false);
    expect(s.aiReady).toBe(false);
    expect(JSON.stringify(s)).not.toContain("super-secret");
    expect(s.items.find((i) => i.key === "FREELLMAPI_API_KEY")?.ok).toBe(false);
  });
});

describe("session tokens", () => {
  it("verifies and rejects tampered / expired / wrong-passcode tokens", async () => {
    const t = await createSessionToken("pass123");
    expect(await verifySessionToken(t, "pass123")).toBe(true);
    expect(await verifySessionToken(t, "other")).toBe(false);
    const flipped = t.slice(0, -1) + (t.endsWith("0") ? "1" : "0"); // always a real change
    expect(await verifySessionToken(flipped, "pass123")).toBe(false);
    expect(await verifySessionToken(await createSessionToken("pass123", Date.now() - 13 * 3600_000), "pass123")).toBe(false);
    expect(await verifySessionToken(undefined, "pass123")).toBe(false);
  });
});
