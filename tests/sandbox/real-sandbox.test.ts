/**
 * OPT-IN: hits the real PayPal Sandbox. Runs only via `npm run test:sandbox` and only when
 * PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are present in .env.local. Creates, sends, reads,
 * reminds and cancels ONE sandbox invoice (test money only).
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PayPalClient } from "@/lib/paypal/client";
import { normalizeInvoiceDraft, addDays } from "@/lib/invoices/schema";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const id = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_CLIENT_SECRET;
const base = process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";
const recipient = process.env.SANDBOX_RECIPIENT_EMAIL || "nexora-sandbox-buyer@example.com";

describe.skipIf(!id || !secret)("real PayPal Sandbox", () => {
  it("is pointed at the sandbox", () => expect(base).toBe("https://api-m.sandbox.paypal.com"));

  it("create → send → get → remind → cancel", async () => {
    const calls: string[] = [];
    const c = new PayPalClient({ baseUrl: base, clientId: id!, clientSecret: secret!, onCall: (r) => calls.push(`${r.method} ${r.endpoint} → ${r.status} debug_id=${r.debugId ?? "-"}`) });
    const today = new Date().toISOString().slice(0, 10);
    const r = normalizeInvoiceDraft(
      { client_name: "NEXORA Sandbox Test", client_email: recipient, tax_percent: "18", tax_name: "GST", items: [{ name: "Landing page redesign (sandbox test)", unit_amount: "800" }], due_date: addDays(today, 14) },
      { currency: "USD", taxName: "Tax", taxMilli: 0, termsDays: 14, today },
    );
    if (!r.ok) throw new Error("fixture invalid");
    const key = `nexora-sandbox-smoke-${Date.now()}`;
    const { invoice } = await c.createDraftInvoice(r.invoice, `${key}-create`);
    expect(invoice.id).toMatch(/^INV2-/);
    expect(invoice.status).toBe("DRAFT");
    await c.sendInvoice(invoice.id, { subject: "NEXORA sandbox test", note: "Sandbox test invoice" }, `${key}-send`);
    const got = await c.getInvoice(invoice.id);
    expect(["SENT", "UNPAID"]).toContain(got.status);
    expect(got.amount?.value).toBe("944.00");
    await c.remindInvoice(invoice.id, { subject: "Reminder (sandbox test)", note: "This is a sandbox reminder test." }, `${key}-remind`);
    await c.cancelInvoice(invoice.id, { subject: "Cancelled (sandbox test)", note: "Test complete." }, `${key}-cancel`);
    expect((await c.getInvoice(invoice.id)).status).toBe("CANCELLED");
    console.log(`\nSANDBOX RESULT invoice=${invoice.id} number=${got.detail.invoice_number} status_after_send=${got.status} amount=${got.amount?.value}\n` + calls.join("\n"));
  }, 60_000);
});
