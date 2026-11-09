import { describe, expect, it } from "vitest";
import { normalizeInvoiceDraft, toDraftInput, type Defaults } from "@/lib/invoices/schema";
import { extractJson, AIProviderError } from "@/lib/ai/provider";
import { InsightsSchema } from "@/lib/ai/insights";

const defaults: Defaults = { currency: "USD", taxName: "GST", taxMilli: 0, termsDays: 14, today: "2026-11-09" };

describe("invoice draft normalization", () => {
  it("normalizes the hero request", () => {
    const r = normalizeInvoiceDraft(
      { client_name: "Acme Corp", client_email: "AP@Acme.com", items: [{ name: "Landing page redesign", unit_amount: "800" }], due_in_days: 14 },
      defaults,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.invoice.client_email).toBe("ap@acme.com");
    expect(r.invoice.total_minor).toBe(80000);
    expect(r.invoice.due_date).toBe("2026-11-23");
    expect(r.invoice.currency).toBe("USD");
    expect(r.invoice.items[0].quantity).toBe("1");
  });

  it("reports a missing email instead of guessing", () => {
    const r = normalizeInvoiceDraft({ client_name: "Acme", items: [{ name: "Work", unit_amount: 100 }] }, defaults);
    expect(r).toEqual({ ok: false, missing: ["client_email"], errors: [] });
  });

  it("rejects invalid emails, currencies, past and far due dates", () => {
    const base = { client_name: "A", client_email: "a@b.co", items: [{ name: "x", unit_amount: "10" }] };
    const bad = (patch: object) => normalizeInvoiceDraft({ ...base, ...patch }, defaults);
    expect(bad({ client_email: "not-an-email" }).ok).toBe(false);
    expect(bad({ currency: "XYZ" }).ok).toBe(false);
    expect(bad({ due_date: "2026-11-01" }).ok).toBe(false);
    expect(bad({ due_date: "2026-02-30" }).ok).toBe(false);
    expect(bad({ due_date: "2028-01-01" }).ok).toBe(false);
    expect(bad({ tax_percent: "150" }).ok).toBe(false);
    expect(bad({ items: [{ name: "x", unit_amount: "0" }] }).ok).toBe(false);
    expect(bad({ items: [{ name: "x", unit_amount: "-4" }] }).ok).toBe(false);
    expect(bad({ items: [] }).ok).toBe(false);
  });

  it("applies configurable tax", () => {
    const r = normalizeInvoiceDraft(
      { client_name: "A", client_email: "a@b.co", tax_percent: 18, tax_name: "GST", currency: "inr", items: [{ name: "x", unit_amount: "1000", quantity: 2 }] },
      defaults,
    );
    expect(r.ok && r.invoice.tax_minor).toBe(36000);
    expect(r.ok && r.invoice.total_minor).toBe(236000);
    expect(r.ok && r.invoice.currency).toBe("INR");
  });

  it("uses workspace default tax when none given", () => {
    const r = normalizeInvoiceDraft({ client_name: "A", client_email: "a@b.co", items: [{ name: "x", unit_amount: "100" }] }, { ...defaults, taxMilli: 20000 });
    expect(r.ok && r.invoice.tax_minor).toBe(2000);
  });

  it("round-trips through the edit form shape", () => {
    const r = normalizeInvoiceDraft({ client_name: "A", client_email: "a@b.co", tax_percent: "7.25", items: [{ name: "x", unit_amount: "99.99", quantity: "1.5" }] }, defaults);
    if (!r.ok) throw new Error("expected ok");
    const again = normalizeInvoiceDraft(toDraftInput(r.invoice), defaults);
    expect(again.ok && again.invoice).toEqual(r.invoice);
  });
});

describe("AI output parsing", () => {
  it("extracts JSON from fenced or chatty output", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(() => extractJson("no json here")).toThrow(AIProviderError);
  });

  it("validates insight shape", () => {
    expect(InsightsSchema.safeParse({ insights: [] }).success).toBe(false);
    expect(InsightsSchema.safeParse({ insights: [{ kind: "risk", title: "Overdue", detail: "Two invoices are late.", metric_keys: ["totals.overdue"] }] }).success).toBe(true);
    expect(InsightsSchema.safeParse({ insights: [{ kind: "doom", title: "x", detail: "y", metric_keys: [] }] }).success).toBe(false);
  });
});
