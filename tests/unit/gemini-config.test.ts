import { describe, expect, it, vi } from "vitest";

import { GeminiProvider as RealProvider, isGemini3 } from "@/lib/ai/gemini";

const generateContent = vi.fn();
const fake = { models: { generateContent } } as never;
class GeminiProvider extends RealProvider {
  constructor(key: string, model: string, timeout: number, level: "minimal" | "low" | "medium" | "high" = "low") {
    super(key, model, timeout, level, fake);
  }
}

const ok = { candidates: [{ content: { role: "model", parts: [{ text: "hi" }] }, finishReason: "STOP" }], functionCalls: undefined };

describe("Gemini provider config", () => {
  it("detects Gemini 3.x models", () => {
    expect(isGemini3("gemini-3.5-flash")).toBe(true);
    expect(isGemini3("models/gemini-3-pro")).toBe(true);
    expect(isGemini3("gemini-2.5-flash")).toBe(false);
  });

  it("uses thinkingLevel and default temperature on Gemini 3.x", async () => {
    generateContent.mockResolvedValueOnce(ok);
    await new GeminiProvider("k", "gemini-3.5-flash", 5000, "low").generate({ system: "s", messages: [{ role: "user", text: "x" }] });
    const cfg = generateContent.mock.calls.at(-1)![0].config;
    expect(cfg.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    expect(cfg.temperature).toBeUndefined();
  });

  it("keeps a low temperature and no thinkingLevel on Gemini 2.5", async () => {
    generateContent.mockResolvedValueOnce(ok);
    await new GeminiProvider("k", "gemini-2.5-flash", 5000, "low").generate({ system: "s", messages: [{ role: "user", text: "x" }] });
    const cfg = generateContent.mock.calls.at(-1)![0].config;
    expect(cfg.thinkingConfig).toBeUndefined();
    expect(cfg.temperature).toBe(0.2);
  });

  it("maps an invalid key (HTTP 400 API_KEY_INVALID) to an auth error without echoing details", async () => {
    generateContent.mockRejectedValueOnce(Object.assign(new Error('{"error":{"code":400,"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}'), { status: 400 }));
    await expect(new GeminiProvider("k", "gemini-3.5-flash", 5000).generate({ system: "s", messages: [{ role: "user", text: "x" }] })).rejects.toMatchObject({ kind: "auth", message: "Gemini rejected the API key" });
  });

  it("maps a SAFETY finish to a refusal", async () => {
    generateContent.mockResolvedValueOnce({ candidates: [{ finishReason: "SAFETY" }] });
    await expect(new GeminiProvider("k", "gemini-3.5-flash", 5000).generate({ system: "s", messages: [{ role: "user", text: "x" }] })).rejects.toMatchObject({ kind: "refusal" });
  });
});
