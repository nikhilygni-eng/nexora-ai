import { describe, expect, it, vi } from "vitest";
import { buildInvoiceBody, PayPalClient, type Fetcher } from "@/lib/paypal/client";
import { PayPalApiError, PayPalNetworkError } from "@/lib/paypal/errors";
import { mockFailNext, mockPayPalFetcher, mockStore } from "@/lib/paypal/mock";
import { normalizeInvoiceDraft } from "@/lib/invoices/schema";
import { redact } from "@/lib/audit";

const inv = (() => {
  const r = normalizeInvoiceDraft(
    { client_name: "Acme Corp", client_email: "ap@acme.com", tax_percent: 18, tax_name: "GST", items: [{ name: "Landing page", unit_amount: "800" }], due_in_days: 14 },
    { currency: "USD", taxName: "Tax", taxMilli: 0, termsDays: 14, today: "2026-11-09" },
  );
  if (!r.ok) throw new Error("fixture");
  return r.invoice;
})();

const client = (fetcher: Fetcher = mockPayPalFetcher) =>
  new PayPalClient({ baseUrl: "https://api-m.sandbox.paypal.com", clientId: "id", clientSecret: "secret", fetcher });

describe("PayPal client", () => {
  it("builds a Invoicing v2 body with string amounts and tax", () => {
    const b = buildInvoiceBody(inv);
    expect(b.detail.currency_code).toBe("USD");
    expect(b.detail.payment_term.due_date).toBe("2026-11-23");
    expect(b.primary_recipients[0].billing_info.email_address).toBe("ap@acme.com");
    expect(b.items[0].unit_amount).toEqual({ currency_code: "USD", value: "800.00" });
    expect(b.items[0].tax).toEqual({ name: "GST", percent: "18" });
  });

  it("caches the OAuth token and sends PayPal-Request-Id", async () => {
    const spy = vi.fn(mockPayPalFetcher);
    const c = client(spy);
    const { invoice } = await c.createDraftInvoice(inv, "req-1");
    await c.sendInvoice(invoice.id, {}, "req-2");
    await c.getInvoice(invoice.id);
    const tokenCalls = spy.mock.calls.filter(([u]) => String(u).endsWith("/v1/oauth2/token"));
    expect(tokenCalls).toHaveLength(1);
    const create = spy.mock.calls.find(([u, i]) => String(u).endsWith("/v2/invoicing/invoices") && i?.method === "POST");
    expect(new Headers(create![1]!.headers).get("PayPal-Request-Id")).toBe("req-1");
    expect(new Headers(create![1]!.headers).get("Authorization")).toMatch(/^Bearer /);
    expect((await c.getInvoice(invoice.id)).status).toBe("SENT");
  });

  it("is idempotent for a repeated PayPal-Request-Id", async () => {
    const c = client();
    const a = await c.createDraftInvoice(inv, "same-key");
    const b = await c.createDraftInvoice(inv, "same-key");
    expect(a.invoice.id).toBe(b.invoice.id);
    expect(mockStore().invoices.size).toBe(1);
  });

  it("maps PayPal errors with debug id to readable messages", async () => {
    mockFailNext(/\/v2\/invoicing\/invoices$/, 422, {
      name: "UNPROCESSABLE_ENTITY",
      debug_id: "abc123",
      details: [{ issue: "CURRENCY_NOT_SUPPORTED", description: "nope" }],
    });
    const err = await client().createDraftInvoice(inv, "k").catch((e) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err.debugId).toBe("abc123");
    expect(err.userMessage).toMatch(/currency/i);
  });

  it("refreshes the token once on 401", async () => {
    let n = 0;
    const f: Fetcher = async (u, i) => {
      if (String(u).includes("/v2/invoicing/invoices/X") && n++ === 0) return new Response("{}", { status: 401 });
      if (String(u).includes("/v2/invoicing/invoices/X")) return new Response(JSON.stringify({ id: "X", status: "SENT", detail: { currency_code: "USD" } }), { status: 200 });
      return mockPayPalFetcher(u, i);
    };
    expect((await client(f).getInvoice("X")).status).toBe("SENT");
  });

  it("wraps network failures", async () => {
    const f: Fetcher = async (u, i) => {
      if (String(u).includes("oauth2")) return mockPayPalFetcher(u, i);
      throw new TypeError("fetch failed");
    };
    await expect(client(f).getInvoice("X")).rejects.toBeInstanceOf(PayPalNetworkError);
  });

  it("redacts secrets from audit details", () => {
    expect(redact({ access_token: "a", nested: { Authorization: "Bearer x", ok: 1 }, h: "Basic abc" })).toEqual({
      access_token: "[redacted]",
      nested: { Authorization: "[redacted]", ok: 1 },
      h: "[redacted]",
    });
  });
});
