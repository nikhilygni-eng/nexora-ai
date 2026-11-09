import "server-only";
import { GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig, type Part } from "@google/genai";
import { AIProviderError, type AIProvider, type AgentMessage, type GenerateRequest, type GenerateResult } from "./provider";

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  private readonly ai: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
    private readonly thinking: "minimal" | "low" | "medium" | "high" = "low",
    client?: Pick<GoogleGenAI, "models">,
  ) {
    this.ai = (client ?? new GoogleGenAI({ apiKey })) as GoogleGenAI;
  }

  /** Gemini 3.x: control reasoning depth and keep the default temperature (Google advises against lowering it). */
  private modelTuning(temperature?: number): Partial<GenerateContentConfig> {
    if (isGemini3(this.model)) {
      return { thinkingConfig: { thinkingLevel: THINKING[this.thinking] } };
    }
    return { temperature: temperature ?? 0.2 };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const contents = toContents(req.messages);
    const signal = req.signal ?? AbortSignal.timeout(this.timeoutMs);
    let res;
    try {
      res = await this.ai.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: req.system,
          ...this.modelTuning(req.temperature),
          abortSignal: signal,
          ...(req.tools?.length
            ? {
                tools: [
                  {
                    functionDeclarations: req.tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      parametersJsonSchema: t.parameters,
                    })),
                  },
                ],
              }
            : {}),
          ...(req.jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: req.jsonSchema.schema } : {}),
        },
      });
    } catch (e) {
      throw mapGeminiError(e, signal);
    }

    if (res.promptFeedback?.blockReason) {
      throw new AIProviderError("refusal", `Prompt blocked: ${res.promptFeedback.blockReason}`);
    }
    const cand = res.candidates?.[0];
    const finish = cand?.finishReason;
    if (finish && ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(String(finish))) {
      throw new AIProviderError("refusal", `Response blocked: ${finish}`);
    }
    if (String(finish) === "MALFORMED_FUNCTION_CALL") {
      throw new AIProviderError("malformed", "Model produced a malformed function call");
    }
    const calls = res.functionCalls ?? [];
    const toolCalls = calls.map((c, i) => ({
      id: c.id ?? `call_${Date.now()}_${i}`,
      name: c.name ?? "unknown",
      args: (c.args ?? {}) as Record<string, unknown>,
    }));
    const text = cand?.content?.parts
      ?.filter((p) => typeof p.text === "string" && !p.thought)
      .map((p) => p.text)
      .join("")
      .trim();
    return { text: text || undefined, toolCalls, raw: cand?.content, servedModel: res.modelVersion ?? this.model };
  }
}

function toContents(messages: AgentMessage[]): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", parts: [{ text: m.text }] });
    else if (m.role === "assistant") {
      if (m.provider === "gemini" && m.raw && typeof m.raw === "object") {
        out.push(m.raw as Content); // preserves thought signatures for multi-turn function calling
      } else {
        const parts: Part[] = [];
        if (m.text) parts.push({ text: m.text });
        for (const c of m.toolCalls ?? []) parts.push({ functionCall: { id: c.id, name: c.name, args: c.args } });
        if (parts.length) out.push({ role: "model", parts });
      }
    } else {
      out.push({
        role: "user",
        parts: m.results.map((r) => ({ functionResponse: { id: r.callId, name: r.name, response: { output: r.output } } })),
      });
    }
  }
  return out;
}

function mapGeminiError(e: unknown, signal: AbortSignal): AIProviderError {
  if (signal.aborted) return new AIProviderError("timeout", "Gemini request timed out");
  const err = e as { status?: number; message?: string; name?: string };
  const msg = err?.message ?? String(e);
  const status = err?.status ?? Number(msg.match(/\b(4\d\d|5\d\d)\b/)?.[1]);
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) return new AIProviderError("auth", "Gemini rejected the API key");
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    const delay = msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
    const quotaId = msg.match(/"quotaId"\s*:\s*"([^"]+)"/)?.[1] ?? "";
    return new AIProviderError("rate_limited", `Gemini quota ${quotaId || "limit"} reached`, {
      retryAfterSec: delay ? Math.ceil(Number(delay[1])) : undefined,
      daily: /PerDay/i.test(quotaId),
    });
  }
  if (status === 404 || /not found/i.test(msg)) return new AIProviderError("unavailable", `Model not available: ${msg}`);
  if (err?.name === "AbortError" || err?.name === "TimeoutError") return new AIProviderError("timeout", msg);
  return new AIProviderError("unavailable", msg);
}

const THINKING = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
} as const;

export function isGemini3(model: string) {
  return /^gemini-3/i.test(model.replace(/^models\//, ""));
}
