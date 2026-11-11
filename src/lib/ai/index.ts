import "server-only";
import { aiModelName, getEnv, type Env } from "@/lib/env";
import { AIGate, GatedProvider, type GateStats } from "./gate";
import { GeminiProvider } from "./gemini";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { AIProviderError, RetryingProvider, type AIProvider } from "./provider";
import { ScriptedProvider } from "./scripted";

const g = globalThis as unknown as {
  __nexoraAI?: { p: AIProvider; key: string };
  __nexoraAIOverride?: AIProvider;
  __nexoraAIGate?: { gate: AIGate; key: string };
};

/** One gate per process, shared by the agent, insights and reminders, so their combined traffic respects the quota. */
function getGate(env: Env): AIGate {
  const key = `${env.AI_MAX_CONCURRENCY}|${env.AI_QUEUE_MAX}|${env.AI_QUEUE_WAIT_MS}|${env.AI_MAX_RPM}`;
  if (g.__nexoraAIGate?.key !== key) {
    g.__nexoraAIGate = {
      key,
      gate: new AIGate({ maxConcurrent: env.AI_MAX_CONCURRENCY, maxQueue: env.AI_QUEUE_MAX, maxWaitMs: env.AI_QUEUE_WAIT_MS, rpm: env.AI_MAX_RPM }),
    };
  }
  return g.__nexoraAIGate.gate;
}

export function getAIProvider(): AIProvider {
  if (g.__nexoraAIOverride) return g.__nexoraAIOverride;
  const env = getEnv();
  const model = aiModelName(env);
  const gate = getGate(env);
  const key = `${env.AI_PROVIDER}|${model}|${env.FREELLMAPI_BASE_URL}|${env.AI_THINKING_LEVEL}|${g.__nexoraAIGate?.key}`;
  if (g.__nexoraAI?.key === key) return g.__nexoraAI.p;
  let p: AIProvider;
  if (env.AI_PROVIDER === "gemini") {
    if (!env.GEMINI_API_KEY) throw new AIProviderError("not_configured", "GEMINI_API_KEY is not set");
    p = new GeminiProvider(env.GEMINI_API_KEY, model, env.AI_TIMEOUT_MS, env.AI_THINKING_LEVEL);
  } else if (env.AI_PROVIDER === "freellmapi") {
    if (!env.FREELLMAPI_API_KEY) throw new AIProviderError("not_configured", "FREELLMAPI_API_KEY is not set");
    p = new OpenAICompatibleProvider("freellmapi", env.FREELLMAPI_BASE_URL, env.FREELLMAPI_API_KEY, model, env.AI_TIMEOUT_MS);
  } else {
    p = new ScriptedProvider();
  }
  // Retries go back through the gate, so a retry also waits for a slot and respects cooldowns.
  p = new GatedProvider(p, gate);
  if (p.id !== "mock") p = new RetryingProvider(p);
  g.__nexoraAI = { p, key };
  return p;
}

/** Live gate counters for /api/health (no secrets). Null before the first AI call or if env is invalid. */
export function getAIGateStats(): GateStats | null {
  return g.__nexoraAIGate?.gate.stats() ?? null;
}

export function setAIProviderForTests(p: AIProvider | undefined) {
  g.__nexoraAIOverride = p;
}
