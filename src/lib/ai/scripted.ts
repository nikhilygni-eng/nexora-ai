import type { AIProvider, AgentMessage, GenerateRequest, GenerateResult } from "./provider";

/**
 * Deterministic test double for E2E/integration tests ONLY (AI_PROVIDER=mock).
 * It exercises the real tool loop, validation and approval flow, but it is not an AI.
 * The UI labels it "Scripted test provider" so it can never be mistaken for a model.
 */
export class ScriptedProvider implements AIProvider {
  readonly id = "mock" as const;
  readonly model = "scripted-test-provider";

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    // Load tests only: simulate a real model's response time so the AI gate is exercised.
    const latency = Number(process.env.AI_MOCK_LATENCY_MS ?? 0);
    if (latency > 0) await new Promise((r) => setTimeout(r, Math.min(latency, 30_000)));
    if (req.jsonSchema?.name === "reminder") {
      const f = JSON.parse(lastUserText(req.messages) || "{}") as { amount_due?: string; invoice_number?: string; due_date?: string };
      return {
        text: JSON.stringify({
          subject: `Reminder: invoice ${f.invoice_number ?? ""} is due`.trim(),
          note: `Hi, a quick reminder that ${f.amount_due ?? "the balance"} on invoice ${f.invoice_number ?? ""} is due on ${f.due_date ?? "the due date"}. You can pay securely through PayPal. Thank you!`,
        }),
        toolCalls: [],
      };
    }
    if (req.jsonSchema) {
      return { text: JSON.stringify({ insights: [{ kind: "trend", title: "Scripted insight", detail: "Test provider output.", metric_keys: ["totals.outstanding"] }] }), toolCalls: [] };
    }
    const last = req.messages[req.messages.length - 1];
    if (last?.role === "tool") {
      const r = last.results[0];
      const out = r.output as { ok?: boolean; proposal_id?: string; missing?: string[]; error?: string };
      if (r.name === "draft_invoice" && out.ok) return { text: "Drafted. Review the invoice card and approve it to send via PayPal Sandbox.", toolCalls: [] };
      if (out.missing?.includes("client_email")) return { text: "What's the client's email address?", toolCalls: [] };
      return { text: out.error ?? "Done.", toolCalls: [] };
    }
    const userText = lastUserText(req.messages);
    const m = userText.match(/bill\s+(.+?)\s+([A-Z]{3})?\s?\$?([\d,.]+)\s+for\s+(.+?)(?:,|\.|$)/i);
    if (m) {
      const email = allUserText(req.messages).match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
      const due = userText.match(/due in (\d+) days/i)?.[1];
      return {
        toolCalls: [
          {
            id: "call_1",
            name: "draft_invoice",
            args: {
              client_name: m[1].trim(),
              client_email: email,
              currency: m[2] ?? "USD",
              items: [{ name: m[4].trim(), quantity: 1, unit_amount: m[3] }],
              due_in_days: due ? Number(due) : undefined,
            },
          },
        ],
      };
    }
    const email = userText.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
    if (email) {
      // Follow-up answer: replay the previous bill request with the email.
      const prev = [...req.messages].reverse().find((x) => x.role === "user" && /bill/i.test(x.text));
      if (prev && prev.role === "user") return this.generate({ ...req, messages: [...req.messages, { role: "user", text: prev.text + " " + email }] });
    }
    return { text: "I can draft invoices, check statuses and summarize receivables.", toolCalls: [] };
  }
}

function lastUserText(ms: AgentMessage[]) {
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    if (m.role === "user") return m.text;
  }
  return "";
}
function allUserText(ms: AgentMessage[]) {
  return ms.filter((m): m is Extract<AgentMessage, { role: "user" }> => m.role === "user").map((m) => m.text).join("\n");
}
