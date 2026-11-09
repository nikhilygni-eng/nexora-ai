import "server-only";
import { logAudit } from "@/lib/audit";
import { appendMessage, ensureConversation, getOrg, listMessages } from "@/lib/db/repo";
import { todayISO } from "@/lib/invoices/service";
import { milliToPercentString } from "@/lib/money";
import { getAIProvider } from ".";
import { AIProviderError, type AgentMessage, type AIProvider, type ToolCall } from "./provider";
import { TOOL_LABELS, TOOLS, type ToolContext } from "./tools";

export const MAX_STEPS = 6;
const HISTORY_LIMIT = 40;

export type TraceStep = { tool: string; label: string; ok: boolean; readOnly: boolean; summary?: string };

export type AgentResult = {
  conversationId: string;
  reply: string;
  trace: TraceStep[];
  proposalIds: string[];
  provider: string;
  model: string;
};

export function systemPrompt(orgId: string): string {
  const org = getOrg(orgId);
  return [
    `You are NEXORA, an invoicing co-pilot for ${org.name}, a freelancer/small business billing international clients.`,
    `Today is ${todayISO()}. Workspace defaults: currency ${org.default_currency}, tax "${org.default_tax_name}" ${milliToPercentString(org.default_tax_milli)}%, payment terms ${org.default_terms_days} days.`,
    "",
    "How you work:",
    "- Turn billing requests into invoices with the draft_invoice tool. Extract client, line items, amounts, currency, tax, due date and note.",
    "- When the user names a client but gives no email, call find_client first. If there is exactly one confident match, use that email and mention it. Otherwise ask.",
    "- NEVER invent, guess or construct an email address. If it's unknown, ask the user for it in one short question.",
    "- If draft_invoice reports missing fields or errors, ask a single concise follow-up question covering them.",
    "- draft_invoice and draft_reminder only create proposals. Nothing reaches PayPal until the user clicks Approve. Never claim an invoice or reminder was sent unless a tool result says so.",
    "- Use list_invoices / get_invoice_status / summarize_receivables to answer questions. Ground every number in tool results. If data includes demo rows, say so.",
    "- For reminders: find the invoice with list_invoices, then call draft_reminder with a polite, specific subject and a note under 120 words that states the amount, invoice number and due date.",
    "- Keep replies short (1–3 sentences), plain and professional. No markdown tables. Don't repeat the full invoice; the UI shows a card.",
    "- Decline requests unrelated to invoicing, receivables, or this workspace.",
  ].join("\n");
}

function rowToMessage(role: string, content: unknown): AgentMessage | null {
  const c = content as Record<string, unknown>;
  if (role === "user" && typeof c.text === "string") return { role: "user", text: c.text };
  if (role === "assistant") return { role: "assistant", text: c.text as string | undefined, toolCalls: c.toolCalls as ToolCall[] | undefined, provider: c.provider as string | undefined, raw: c.raw };
  if (role === "tool" && Array.isArray(c.results)) return { role: "tool", results: c.results as never };
  return null;
}

/** Trim history to a window that starts on a user message (so tool call/response pairs stay intact). */
function windowed(history: AgentMessage[]): AgentMessage[] {
  if (history.length <= HISTORY_LIMIT) return history;
  let start = history.length - HISTORY_LIMIT;
  while (start < history.length && history[start].role !== "user") start++;
  return history.slice(start);
}

export async function runAgent(opts: { orgId: string; conversationId?: string | null; message: string; provider?: AIProvider }): Promise<AgentResult> {
  const provider = opts.provider ?? getAIProvider(); // throws AIProviderError("not_configured")
  const conversationId = ensureConversation(opts.orgId, opts.conversationId, opts.message);
  const history = listMessages(opts.orgId, conversationId)
    .map((r) => rowToMessage(r.role, JSON.parse(r.content_json)))
    .filter((m): m is AgentMessage => m !== null);

  const userMsg: AgentMessage = { role: "user", text: opts.message };
  appendMessage(opts.orgId, conversationId, "user", { text: opts.message });
  const messages: AgentMessage[] = [...windowed(history), userMsg];

  const ctx: ToolContext = {
    orgId: opts.orgId,
    conversationId,
    userTexts: [...history, userMsg].filter((m): m is Extract<AgentMessage, { role: "user" }> => m.role === "user").map((m) => m.text),
    createdProposalIds: [],
  };
  const trace: TraceStep[] = [];
  const system = systemPrompt(opts.orgId);
  const toolSpecs = TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
  let reply = "";
  let malformedRetries = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    let res;
    try {
      res = await provider.generate({ system, messages, tools: toolSpecs });
    } catch (e) {
      if (e instanceof AIProviderError && e.kind === "malformed" && malformedRetries < 1) {
        malformedRetries++;
        continue;
      }
      throw e;
    }

    if (!res.toolCalls.length) {
      reply = res.text ?? "";
      if (!reply) {
        if (malformedRetries < 1) {
          malformedRetries++;
          continue;
        }
        throw new AIProviderError("malformed", "Model returned an empty response");
      }
      const final: AgentMessage = { role: "assistant", text: reply, provider: provider.id, raw: res.raw };
      messages.push(final);
      appendMessage(opts.orgId, conversationId, "assistant", { text: reply, provider: provider.id, raw: res.raw, model: res.servedModel });
      break;
    }

    // Model wants tools: run them (write tools only create proposals), then loop.
    const assistantTurn: AgentMessage = { role: "assistant", text: res.text, toolCalls: res.toolCalls, provider: provider.id, raw: res.raw };
    messages.push(assistantTurn);
    appendMessage(opts.orgId, conversationId, "assistant", { text: res.text, toolCalls: res.toolCalls, provider: provider.id, raw: res.raw });

    const results: { callId: string; name: string; output: unknown }[] = [];
    for (const call of res.toolCalls) {
      const tool = TOOLS.find((t) => t.name === call.name);
      let output: unknown;
      if (!tool) output = { ok: false, error: `Unknown tool ${call.name}` };
      else if (call.malformed) output = { ok: false, error: call.malformed + ". Call the tool again with valid JSON arguments." };
      else {
        const parsed = tool.args.safeParse(call.args);
        if (!parsed.success) {
          output = { ok: false, error: "Invalid arguments: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
        } else {
          try {
            output = await tool.run(ctx, parsed.data);
          } catch (e) {
            output = { ok: false, error: (e as Error).message };
          }
        }
      }
      const ok = !(output && typeof output === "object" && "ok" in output && (output as { ok: unknown }).ok === false);
      trace.push({
        tool: call.name,
        label: TOOL_LABELS[call.name] ?? call.name,
        ok,
        readOnly: tool?.readOnly ?? true,
        summary: ok ? undefined : String((output as { error?: string; missing?: string[] }).error ?? `Missing: ${((output as { missing?: string[] }).missing ?? []).join(", ")}`),
      });
      results.push({ callId: call.id, name: call.name, output });
    }
    const toolTurn: AgentMessage = { role: "tool", results };
    messages.push(toolTurn);
    appendMessage(opts.orgId, conversationId, "tool", { results });

    if (step === MAX_STEPS - 1) {
      reply = ctx.createdProposalIds.length
        ? "I've prepared a draft for your review."
        : "I couldn't finish that in a few steps. Try rephrasing with the client, amount and due date.";
      appendMessage(opts.orgId, conversationId, "assistant", { text: reply, provider: "system" });
    }
  }

  logAudit({
    orgId: opts.orgId,
    actor: "ai",
    action: "agent.turn",
    entityType: "conversation",
    entityId: conversationId,
    details: { provider: provider.id, model: provider.model, tools: trace.map((t) => `${t.tool}:${t.ok ? "ok" : "err"}`), proposals: ctx.createdProposalIds },
  });

  return { conversationId, reply, trace, proposalIds: ctx.createdProposalIds, provider: provider.id, model: provider.model };
}
