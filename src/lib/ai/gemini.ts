import "server-only";
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { AIProviderError, type AIProvider, type AgentMessage, type GenerateRequest, type GenerateResult } from "./provider";

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string, readonly model: string, private readonly timeoutMs: number) {
    this.ai = new GoogleGenAI({ apiKey });
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
          temperature: req.temperature ?? 0.2,
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
  if (status === 401 || status === 403 || /API key not valid|PERMISSION_DENIED/i.test(msg)) return new AIProviderError("auth", msg);
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return new AIProviderError("rate_limited", msg);
  if (status === 404 || /not found/i.test(msg)) return new AIProviderError("unavailable", `Model not available: ${msg}`);
  if (err?.name === "AbortError" || err?.name === "TimeoutError") return new AIProviderError("timeout", msg);
  return new AIProviderError("unavailable", msg);
}
