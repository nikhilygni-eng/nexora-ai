/**
 * Provider-agnostic LLM interface. Implementations: Gemini (@google/genai), FreeLLMAPI (OpenAI-compatible),
 * and a scripted test provider for E2E. Adding Anthropic/OpenAI = one new file implementing AIProvider.
 */

export type JSONSchema = Record<string, unknown>;

export type ToolSpec = { name: string; description: string; parameters: JSONSchema };

export type ToolCall = { id: string; name: string; args: Record<string, unknown>; malformed?: string };

export type AgentMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[]; provider?: string; raw?: unknown }
  | { role: "tool"; results: { callId: string; name: string; output: unknown }[] };

export type GenerateRequest = {
  system: string;
  messages: AgentMessage[];
  tools?: ToolSpec[];
  /** Ask for a JSON object matching this schema (no tools). */
  jsonSchema?: { name: string; schema: JSONSchema };
  temperature?: number;
  signal?: AbortSignal;
};

export type GenerateResult = {
  text?: string;
  toolCalls: ToolCall[];
  /** Provider-native assistant turn, replayed verbatim on the next request (e.g. Gemini thought signatures). */
  raw?: unknown;
  servedModel?: string;
};

export type AIErrorKind = "not_configured" | "timeout" | "refusal" | "rate_limited" | "auth" | "unavailable" | "malformed" | "busy";

export class AIProviderError extends Error {
  constructor(
    public readonly kind: AIErrorKind,
    message: string,
    /** For rate limits: seconds until the provider accepts requests again, and whether it's a daily quota. */
    public readonly quota?: { retryAfterSec?: number; daily?: boolean },
  ) {
    super(message);
    this.name = "AIProviderError";
  }
  get userMessage(): string {
    switch (this.kind) {
      case "not_configured":
        return "AI isn't configured. Add an API key in .env.local (see Settings → Setup).";
      case "timeout":
        return "The AI model took too long to answer. Try again.";
      case "refusal":
        return "The AI model declined this request. Rephrase it as an invoicing task.";
      case "rate_limited":
        if (this.quota?.daily) {
          return "The AI model's daily free-tier quota is used up. Switch AI_MODEL (e.g. gemini-3.5-flash-lite) or enable billing for the API key.";
        }
        return this.quota?.retryAfterSec
          ? `The AI provider's per-minute limit was reached. Try again in ${this.quota.retryAfterSec} seconds.`
          : "The AI provider is rate-limiting requests. Wait a few seconds and try again.";
      case "auth":
        return "The AI provider rejected the API key. Check it in .env.local.";
      case "malformed":
        return "The AI model returned an unreadable answer. Try again.";
      case "busy":
        return this.quota?.retryAfterSec
          ? `NEXORA's AI is handling a lot of requests right now, so yours wasn't started. Try again in ${this.quota.retryAfterSec} seconds.`
          : "NEXORA's AI is handling a lot of requests right now, so yours wasn't started. Try again in a few seconds.";
      default:
        return "The AI provider is unavailable right now. Try again shortly.";
    }
  }
}

export interface AIProvider {
  readonly id: "gemini" | "freellmapi" | "mock";
  readonly model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export function classifyHttpStatus(status: number): AIErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  return "unavailable";
}

/** Extract a JSON object from model text that may be wrapped in prose or ```json fences. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    throw new AIProviderError("malformed", "Model output was not valid JSON");
  }
}

/**
 * Retries transient provider failures (overloaded / rate-limited) once with backoff.
 * Never retries auth, refusal, timeout or malformed output.
 */
export class RetryingProvider implements AIProvider {
  constructor(private readonly inner: AIProvider, private readonly delaysMs: number[] = [1500]) {}
  get id() {
    return this.inner.id;
  }
  get model() {
    return this.inner.model;
  }
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.inner.generate(req);
      } catch (e) {
        // Daily quotas and long waits are not worth retrying inside a request.
        const transient =
          e instanceof AIProviderError &&
          (e.kind === "unavailable" || (e.kind === "rate_limited" && !e.quota?.daily && (e.quota?.retryAfterSec ?? 0) <= 3));
        if (!transient || attempt >= this.delaysMs.length || req.signal?.aborted) throw e;
        console.warn(`[ai] ${this.inner.id} ${e.kind}, retrying in ${this.delaysMs[attempt]}ms: ${e.message.slice(0, 200)}`);
        await new Promise((r) => setTimeout(r, this.delaysMs[attempt]));
      }
    }
  }
}
