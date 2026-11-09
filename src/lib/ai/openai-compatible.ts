import "server-only";
import {
  AIProviderError,
  classifyHttpStatus,
  type AIProvider,
  type AgentMessage,
  type GenerateRequest,
  type GenerateResult,
  type ToolCall,
} from "./provider";

type OAIMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

/**
 * OpenAI-compatible chat completions provider. Used for FreeLLMAPI (local router at /v1),
 * and works unchanged for OpenAI or any compatible gateway.
 */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    readonly id: "freellmapi",
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const signal = req.signal ?? AbortSignal.timeout(this.timeoutMs);
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toMessages(req.system, req.messages),
      temperature: req.temperature ?? 0.2,
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = "auto";
    }
    if (req.jsonSchema) {
      body.response_format = { type: "json_schema", json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: false } };
    }
    let res: Response;
    try {
      res = await this.fetcher(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal.aborted) throw new AIProviderError("timeout", "AI request timed out");
      throw new AIProviderError("unavailable", `Couldn't reach ${this.baseUrl}: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new AIProviderError(classifyHttpStatus(res.status), `HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    const json = (await res.json().catch(() => null)) as {
      model?: string;
      choices?: {
        finish_reason?: string;
        message?: { content?: string | null; refusal?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] };
      }[];
    } | null;
    const choice = json?.choices?.[0];
    if (!choice?.message) throw new AIProviderError("malformed", "No choices in response");
    if (choice.message.refusal) throw new AIProviderError("refusal", choice.message.refusal);
    if (choice.finish_reason === "content_filter") throw new AIProviderError("refusal", "Content filtered");

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc, i) => {
      const id = tc.id ?? `call_${Date.now()}_${i}`;
      const name = tc.function?.name ?? "unknown";
      try {
        const args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        return { id, name, args: args && typeof args === "object" ? args : {} };
      } catch {
        return { id, name, args: {}, malformed: "Tool arguments were not valid JSON" };
      }
    });
    const servedModel = res.headers.get("x-routed-via") ?? json?.model ?? this.model;
    return { text: choice.message.content?.trim() || undefined, toolCalls, servedModel };
  }
}

function toMessages(system: string, messages: AgentMessage[]): OAIMessage[] {
  const out: OAIMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.text });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text ?? null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : {}),
      });
    } else {
      for (const r of m.results) out.push({ role: "tool", tool_call_id: r.callId, content: JSON.stringify(r.output) });
    }
  }
  return out;
}
