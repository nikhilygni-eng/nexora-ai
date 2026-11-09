import { describe, expect, it, vi } from "vitest";
import { runAgent } from "@/lib/ai/agent";
import type { AIProvider, GenerateRequest } from "@/lib/ai/provider";
import { DEFAULT_ORG_ID } from "@/lib/db";
import { getInvoiceByProposal, getProposal, listProposals, upsertClient } from "@/lib/db/repo";
import { approveProposal, ApprovalConflictError, cancelProposal, syncInvoice } from "@/lib/invoices/service";
import { setPayPalFetcherForTests } from "@/lib/paypal";
import { mockFailNext, mockMarkPaid, mockPayPalFetcher } from "@/lib/paypal/mock";
import { listAudit } from "@/lib/audit";
import { ScriptedProvider } from "@/lib/ai/scripted";
import { draftReminderProposal } from "@/lib/ai/reminder";
import { setAIProviderForTests } from "@/lib/ai";

const ORG = DEFAULT_ORG_ID;

function spyPayPal() {
  const spy = vi.fn(mockPayPalFetcher);
  setPayPalFetcherForTests(spy);
  const writes = () => spy.mock.calls.filter(([u, i]) => i?.method === "POST" && !String(u).includes("oauth2")).map(([u]) => new URL(String(u)).pathname);
  return { spy, writes };
}

/** A provider that always tries to call draft_invoice with a fabricated email. */
class HallucinatingProvider implements AIProvider {
  readonly id = "mock" as const;
  readonly model = "hallucinator";
  calls = 0;
  async generate(req: GenerateRequest) {
    this.calls++;
    const last = req.messages[req.messages.length - 1];
    if (last.role === "tool") return { text: "Need the email.", toolCalls: [] };
    return { toolCalls: [{ id: "c1", name: "draft_invoice", args: { client_name: "Acme Corp", client_email: "billing@acme.com", items: [{ name: "Redesign", unit_amount: 800 }] } }] };
  }
}

describe("proposal → approve → PayPal", () => {
  it("agent turn creates a pending proposal and makes NO PayPal write", async () => {
    const { writes } = spyPayPal();
    const r = await runAgent({ orgId: ORG, message: "Bill Acme Corp $800 for the landing page redesign, due in 14 days. Email ap@acme.com", provider: new ScriptedProvider() });
    expect(r.proposalIds).toHaveLength(1);
    const p = getProposal(ORG, r.proposalIds[0])!;
    expect(p.status).toBe("pending_approval");
    expect(JSON.parse(p.payload_json).total_minor).toBe(80000);
    expect(writes()).toEqual([]);
  });

  it("asks a follow-up instead of guessing a missing email", async () => {
    const r = await runAgent({ orgId: ORG, message: "Bill Acme Corp $800 for the landing page redesign, due in 14 days.", provider: new ScriptedProvider() });
    expect(r.proposalIds).toHaveLength(0);
    expect(r.reply).toMatch(/email/i);
    const r2 = await runAgent({ orgId: ORG, conversationId: r.conversationId, message: "ap@acme.com", provider: new ScriptedProvider() });
    expect(r2.proposalIds).toHaveLength(1);
  });

  it("blocks an email the model invented", async () => {
    const r = await runAgent({ orgId: ORG, message: "Bill Acme Corp $800 for the redesign", provider: new HallucinatingProvider() });
    expect(r.proposalIds).toHaveLength(0);
    expect(r.trace[0]).toMatchObject({ tool: "draft_invoice", ok: false });
    expect(listProposals(ORG)).toHaveLength(0);
  });

  it("accepts an email from a saved client", async () => {
    upsertClient(ORG, { name: "Acme Corp", email: "billing@acme.com" });
    const r = await runAgent({ orgId: ORG, message: "Bill Acme Corp $800 for the redesign", provider: new HallucinatingProvider() });
    expect(r.proposalIds).toHaveLength(1);
  });

  it("approve creates and sends exactly once, even with concurrent clicks", async () => {
    const r = await runAgent({ orgId: ORG, message: "Bill Acme Corp $800 for the landing page redesign. ap@acme.com", provider: new ScriptedProvider() });
    const { writes } = spyPayPal();
    const id = r.proposalIds[0];
    const results = await Promise.allSettled([approveProposal(ORG, id), approveProposal(ORG, id), approveProposal(ORG, id)]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected" && x.reason instanceof ApprovalConflictError)).toHaveLength(2);
    const w = writes();
    expect(w.filter((p) => p === "/v2/invoicing/invoices")).toHaveLength(1);
    expect(w.filter((p) => p.endsWith("/send"))).toHaveLength(1);
    const inv = getInvoiceByProposal(ORG, id)!;
    expect(inv.source).toBe("mock_paypal");
    expect(inv.paypal_invoice_id).toMatch(/^INV2-/);
    expect(inv.paypal_status).toBe("SENT");
    expect(getProposal(ORG, id)!.status).toBe("executed");
    await expect(approveProposal(ORG, id)).rejects.toBeInstanceOf(ApprovalConflictError);
    const actions = listAudit(ORG).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["proposal.created", "proposal.approved", "paypal.invoice.created", "paypal.invoice.sent", "proposal.executed"]));
  });

  it("retries after a send failure without creating a second PayPal invoice", async () => {
    const r = await runAgent({ orgId: ORG, message: "Bill Acme Corp $800 for the redesign. ap@acme.com", provider: new ScriptedProvider() });
    const { writes } = spyPayPal();
    mockFailNext(/\/send$/, 503, { name: "INTERNAL_SERVICE_ERROR", debug_id: "dbg-503" });
    await expect(approveProposal(ORG, r.proposalIds[0])).rejects.toThrow(/temporary error/i);
    expect(getProposal(ORG, r.proposalIds[0])!.status).toBe("failed");
    await approveProposal(ORG, r.proposalIds[0]);
    expect(writes().filter((p) => p === "/v2/invoicing/invoices")).toHaveLength(1);
    expect(writes().filter((p) => p.endsWith("/send"))).toHaveLength(2);
    expect(getProposal(ORG, r.proposalIds[0])!.status).toBe("executed");
    expect(listAudit(ORG).some((a) => a.debug_id === "dbg-503")).toBe(true);
  });

  it("cancelled proposals can never be executed", async () => {
    const r = await runAgent({ orgId: ORG, message: "Bill Acme Corp $800 for the redesign. ap@acme.com", provider: new ScriptedProvider() });
    const { writes } = spyPayPal();
    cancelProposal(ORG, r.proposalIds[0]);
    await expect(approveProposal(ORG, r.proposalIds[0])).rejects.toBeInstanceOf(ApprovalConflictError);
    expect(writes()).toEqual([]);
  });

  it("syncs paid status from PayPal and gates reminders on approval", async () => {
    setAIProviderForTests({
      id: "mock",
      model: "t",
      generate: async () => ({ text: JSON.stringify({ subject: "Friendly reminder: invoice due", note: "Hi, a quick reminder that $800.00 is due." }), toolCalls: [] }),
    });
    const r = await runAgent({ orgId: ORG, message: "Bill Acme Corp $800 for the redesign. ap@acme.com", provider: new ScriptedProvider() });
    await approveProposal(ORG, r.proposalIds[0]);
    const inv = getInvoiceByProposal(ORG, r.proposalIds[0])!;
    const { writes } = spyPayPal();

    const reminder = await draftReminderProposal(ORG, inv);
    expect(reminder.status).toBe("pending_approval");
    expect(writes()).toEqual([]); // drafting never sends
    await approveProposal(ORG, reminder.id);
    expect(writes().filter((p) => p.endsWith("/remind"))).toHaveLength(1);

    mockMarkPaid(inv.paypal_invoice_id!);
    const s = await syncInvoice(ORG, inv.id);
    expect(s.changed).toBe(true);
    expect(s.row.status).toBe("paid");
    expect(s.row.paid_minor).toBe(80000);

    // A reminder for a now-paid invoice is refused at approval time.
    const late = await draftReminderProposal(ORG, getInvoiceByProposal(ORG, r.proposalIds[0])!);
    await expect(approveProposal(ORG, late.id)).rejects.toThrow(/PAID/);
    expect(writes().filter((p) => p.endsWith("/remind"))).toHaveLength(1);
  });
});

describe("PayPal idempotency beyond PayPal-Request-Id", () => {
  it("recovers when PayPal created the invoice but the response was lost (no duplicate)", async () => {
    const { mockLoseNextResponse, mockStore } = await import("@/lib/paypal/mock");
    const r = await runAgent({ orgId: ORG, message: "Bill Acme Corp $800 for the redesign. ap@acme.com", provider: new ScriptedProvider() });
    const id = r.proposalIds[0];
    mockLoseNextResponse(/\/v2\/invoicing\/invoices$/);
    await expect(approveProposal(ORG, id)).rejects.toThrow(/reach PayPal/i);
    expect(mockStore().invoices.size).toBe(1); // PayPal has it, we don't know yet
    await approveProposal(ORG, id); // user clicks Retry
    expect(mockStore().invoices.size).toBe(1); // recovered by invoice number, not re-created
    const inv = getInvoiceByProposal(ORG, id)!;
    expect(inv.invoice_number).toMatch(/^NX-[0-9A-F]{12}$/);
    expect(inv.paypal_status).toBe("SENT");
    expect(listAudit(ORG).some((a) => a.action === "paypal.invoice.recovered")).toBe(true);
  });
});

describe("transient AI errors", () => {
  it("retries once on unavailable, never on auth", async () => {
    const { RetryingProvider, AIProviderError } = await import("@/lib/ai/provider");
    let n = 0;
    const flaky = { id: "gemini" as const, model: "m", generate: async () => { if (n++ === 0) throw new AIProviderError("unavailable", "503"); return { text: "ok", toolCalls: [] }; } };
    expect((await new RetryingProvider(flaky, [1]).generate({ system: "", messages: [] })).text).toBe("ok");
    let m = 0;
    const bad = { id: "gemini" as const, model: "m", generate: async () => { m++; throw new AIProviderError("auth", "bad key"); } };
    await expect(new RetryingProvider(bad, [1]).generate({ system: "", messages: [] })).rejects.toMatchObject({ kind: "auth" });
    expect(m).toBe(1);
  });
});
