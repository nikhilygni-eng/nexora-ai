import "server-only";
import { aiModelName, getEnv } from "@/lib/env";
import { GeminiProvider } from "./gemini";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { AIProviderError, type AIProvider } from "./provider";
import { ScriptedProvider } from "./scripted";

const g = globalThis as unknown as { __nexoraAI?: { p: AIProvider; key: string }; __nexoraAIOverride?: AIProvider };

export function getAIProvider(): AIProvider {
  if (g.__nexoraAIOverride) return g.__nexoraAIOverride;
  const env = getEnv();
  const model = aiModelName(env);
  const key = `${env.AI_PROVIDER}|${model}|${env.FREELLMAPI_BASE_URL}`;
  if (g.__nexoraAI?.key === key) return g.__nexoraAI.p;
  let p: AIProvider;
  if (env.AI_PROVIDER === "gemini") {
    if (!env.GEMINI_API_KEY) throw new AIProviderError("not_configured", "GEMINI_API_KEY is not set");
    p = new GeminiProvider(env.GEMINI_API_KEY, model, env.AI_TIMEOUT_MS);
  } else if (env.AI_PROVIDER === "freellmapi") {
    if (!env.FREELLMAPI_API_KEY) throw new AIProviderError("not_configured", "FREELLMAPI_API_KEY is not set");
    p = new OpenAICompatibleProvider("freellmapi", env.FREELLMAPI_BASE_URL, env.FREELLMAPI_API_KEY, model, env.AI_TIMEOUT_MS);
  } else {
    p = new ScriptedProvider();
  }
  g.__nexoraAI = { p, key };
  return p;
}

export function setAIProviderForTests(p: AIProvider | undefined) {
  g.__nexoraAIOverride = p;
}
