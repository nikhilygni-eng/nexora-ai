import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { listAudit } from "@/lib/audit";
import { DEFAULT_ORG_ID, getDb } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { setPayPalFetcherForTests } from "@/lib/paypal";
import { mockPayPalFetcher } from "@/lib/paypal/mock";
import { POST } from "@/app/api/webhooks/paypal/route";

const event = {
  id: "WH-EVENT-123",
  event_type: "INVOICING.INVOICE.PAID",
  resource: { id: "INV2-NOT-OUR-INVOICE" },
};

function webhook(body: unknown, signature: string) {
  return new NextRequest("http://localhost:3000/api/webhooks/paypal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "paypal-transmission-sig": signature,
    },
    body: JSON.stringify(body),
  });
}

function storedEvents() {
  return getDb()
    .prepare("SELECT id, verified FROM webhook_events ORDER BY received_at")
    .all() as { id: string; verified: number }[];
}

beforeEach(() => {
  process.env.PAYPAL_WEBHOOK_ID = "WH-SANDBOX-TEST";
  resetEnvCache();
  setPayPalFetcherForTests(async (url, init) => {
    if (new URL(url).pathname === "/v1/notifications/verify-webhook-signature") {
      const req = JSON.parse(String(init?.body)) as { transmission_sig: string };
      return Response.json({ verification_status: req.transmission_sig === "valid-test-signature" ? "SUCCESS" : "FAILURE" });
    }
    return mockPayPalFetcher(url, init);
  });
});

describe("PayPal webhook admission security", () => {
  it("invalid signature cannot consume a legitimate event ID before verification", async () => {
    const forged = await POST(webhook(event, "forged-signature"));
    expect(forged.status).toBe(400);
    expect(storedEvents()).toEqual([]);

    const legitimate = await POST(webhook(event, "valid-test-signature"));
    expect(legitimate.status).toBe(200);
    expect(await legitimate.json()).toEqual({ ok: true });
    expect(storedEvents()).toEqual([{ id: event.id, verified: 1 }]);

    const replay = await POST(webhook(event, "valid-test-signature"));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true, duplicate: true });
    expect(storedEvents()).toHaveLength(1);

    const actions = listAudit(DEFAULT_ORG_ID).map((entry) => entry.action);
    expect(actions).toContain("webhook.rejected");
    expect(actions).toContain("webhook.received");
  });

  it("forged replay is not accepted as a duplicate of a verified event", async () => {
    expect((await POST(webhook(event, "valid-test-signature"))).status).toBe(200);
    const forgery = await POST(webhook(event, "forged-signature"));
    expect(forgery.status).toBe(400);
    expect(storedEvents()).toEqual([{ id: event.id, verified: 1 }]);
  });

  it("retries a verified invoice event after a temporary PayPal sync failure", async () => {
    const { runAgent } = await import("@/lib/ai/agent");
    const { ScriptedProvider } = await import("@/lib/ai/scripted");
    const { approveProposal } = await import("@/lib/invoices/service");
    const { getInvoiceByProposal } = await import("@/lib/db/repo");
    const { mockMarkPaid, mockFailNext } = await import("@/lib/paypal/mock");

    const draft = await runAgent({
      orgId: DEFAULT_ORG_ID,
      message: "Bill Acme Corp $800 for the redesign. ap@acme.com",
      provider: new ScriptedProvider(),
    });
    await approveProposal(DEFAULT_ORG_ID, draft.proposalIds[0]);
    const invoice = getInvoiceByProposal(DEFAULT_ORG_ID, draft.proposalIds[0])!;
    expect(invoice.paypal_invoice_id).toBeTruthy();
    mockMarkPaid(invoice.paypal_invoice_id!);

    const paidEvent = {
      id: "WH-PAYMENT-RETRY",
      event_type: "INVOICING.INVOICE.PAID",
      resource: { id: invoice.paypal_invoice_id },
    };
    mockFailNext(new RegExp("/v2/invoicing/invoices/INV2-"), 503, { name: "INTERNAL_SERVER_ERROR" });

    const first = await POST(webhook(paidEvent, "valid-test-signature"));
    expect(first.status).toBe(503); // PayPal should retry this notification
    expect(storedEvents()).toEqual([]);
    expect(getInvoiceByProposal(DEFAULT_ORG_ID, draft.proposalIds[0])?.status).not.toBe("paid");

    const second = await POST(webhook(paidEvent, "valid-test-signature"));
    expect(second.status).toBe(200);
    expect(storedEvents()).toEqual([{ id: paidEvent.id, verified: 1 }]);
    expect(getInvoiceByProposal(DEFAULT_ORG_ID, draft.proposalIds[0])?.status).toBe("paid");
  });

  it.each([null, [], "invalid", { event_type: "INVOICING.INVOICE.PAID" }])(
    "rejects malformed webhook event %j without crashing or mutating the database",
    async (payload) => {
      const response = await POST(webhook(payload, "valid-test-signature"));
      expect(response.status).toBe(400);
      expect(storedEvents()).toEqual([]);
    },
  );
});
