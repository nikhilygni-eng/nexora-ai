/**
 * In-process fake of the PayPal Invoicing v2 endpoints NEXORA uses.
 * Used ONLY when PAYPAL_MODE=mock (local dev/E2E) and in unit tests.
 * Rows created through it are stored with source='mock_paypal' and labeled in the UI.
 */
import type { Fetcher } from "./client";
import type { PayPalInvoice } from "./types";

type Store = {
  invoices: Map<string, PayPalInvoice & { _reminders: number }>;
  requestIds: Map<string, { status: number; body: string }>;
  counter: number;
  calls: { method: string; path: string; requestId?: string }[];
  failNext?: { path: RegExp; status: number; body: unknown };
};

const g = globalThis as unknown as { __nexoraMockPayPal?: Store };

export function mockStore(): Store {
  if (!g.__nexoraMockPayPal) {
    g.__nexoraMockPayPal = { invoices: new Map(), requestIds: new Map(), counter: 0, calls: [] };
  }
  return g.__nexoraMockPayPal;
}

export function resetMockPayPal() {
  g.__nexoraMockPayPal = undefined;
}

/** Simulate a payer paying the invoice (test/demo helper for mock mode only). */
export function mockMarkPaid(id: string) {
  const inv = mockStore().invoices.get(id);
  if (!inv) return false;
  inv.status = "PAID";
  inv.payments = { paid_amount: inv.amount, transactions: [{ payment_date: new Date().toISOString().slice(0, 10) }] };
  inv.due_amount = { currency_code: inv.detail.currency_code, value: "0.00" };
  return true;
}

export function mockFailNext(path: RegExp, status: number, body: unknown) {
  mockStore().failNext = { path, status, body };
}

function json(status: number, body: unknown, debugId = "mock-debug-" + Math.random().toString(36).slice(2, 10)) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "paypal-debug-id": debugId },
  });
}

type ItemIn = { quantity: string; unit_amount: { value: string }; tax?: { percent: string } };

function computeTotal(items: ItemIn[]): number {
  let cents = 0;
  for (const it of items) {
    const sub = Math.round(Number(it.unit_amount.value) * 100 * Number(it.quantity));
    const tax = it.tax ? Math.round((sub * Number(it.tax.percent)) / 100) : 0;
    cents += sub + tax;
  }
  return cents;
}

export const mockPayPalFetcher: Fetcher = async (input, init) => {
  const url = new URL(input);
  const path = url.pathname;
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  const requestId = headers.get("PayPal-Request-Id") ?? undefined;
  const s = mockStore();
  s.calls.push({ method, path, requestId });
  await new Promise((r) => setTimeout(r, 40));

  if (s.failNext && s.failNext.path.test(path)) {
    const f = s.failNext;
    s.failNext = undefined;
    return json(f.status, f.body);
  }

  if (path === "/v1/oauth2/token" && method === "POST") {
    return json(200, { access_token: "mock-access-token", token_type: "Bearer", expires_in: 32400 });
  }
  if (!headers.get("Authorization")?.startsWith("Bearer ")) return json(401, { name: "AUTHENTICATION_FAILURE" });

  if (requestId && method === "POST") {
    const cacheKey = `${path}::${requestId}`;
    const prev = s.requestIds.get(cacheKey);
    if (prev) return new Response(prev.body || null, { status: prev.status, headers: { "content-type": "application/json" } });
    const res = await handle(method, path, init?.body ? JSON.parse(String(init.body)) : undefined, s);
    const body = await res.clone().text();
    s.requestIds.set(cacheKey, { status: res.status, body });
    return res;
  }
  return handle(method, path, init?.body ? JSON.parse(String(init.body)) : undefined, s);
};

async function handle(method: string, path: string, body: Record<string, unknown> | undefined, s: Store): Promise<Response> {
  if (path === "/v2/invoicing/invoices" && method === "POST") {
    const b = body as {
      detail: { currency_code: string; invoice_date: string; payment_term: { due_date: string } };
      primary_recipients: { billing_info: { email_address: string } }[];
      items: ItemIn[];
    };
    const email = b.primary_recipients?.[0]?.billing_info?.email_address;
    if (!email || !/@/.test(email)) {
      return json(422, {
        name: "UNPROCESSABLE_ENTITY",
        message: "The requested action could not be performed.",
        details: [{ field: "primary_recipients[0].billing_info.email_address", issue: "INVALID_EMAIL_ADDRESS" }],
      });
    }
    s.counter += 1;
    const id = `INV2-MOCK-${String(s.counter).padStart(4, "0")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const total = computeTotal(b.items);
    const inv: PayPalInvoice & { _reminders: number } = {
      id,
      status: "DRAFT",
      detail: {
        invoice_number: `MOCK-${String(1000 + s.counter)}`,
        currency_code: b.detail.currency_code,
        invoice_date: b.detail.invoice_date,
        payment_term: b.detail.payment_term,
        metadata: { create_time: new Date().toISOString(), recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${id}` },
      },
      amount: { currency_code: b.detail.currency_code, value: (total / 100).toFixed(2) },
      due_amount: { currency_code: b.detail.currency_code, value: (total / 100).toFixed(2) },
      _reminders: 0,
    };
    s.invoices.set(id, inv);
    return json(201, strip(inv));
  }
  const m = path.match(/^\/v2\/invoicing\/invoices\/([^/]+)(?:\/(send|remind|cancel))?$/);
  if (m) {
    const inv = s.invoices.get(decodeURIComponent(m[1]));
    if (!inv) return json(404, { name: "RESOURCE_NOT_FOUND", message: "The specified resource does not exist." });
    const action = m[2];
    if (!action && method === "GET") return json(200, strip(inv));
    if (action === "send" && method === "POST") {
      if (inv.status !== "DRAFT") return invalidStatus();
      inv.status = "SENT";
      inv.detail.metadata = { ...inv.detail.metadata, first_sent_time: new Date().toISOString() };
      return json(200, { href: inv.detail.metadata?.recipient_view_url, rel: "payer-view", method: "GET" });
    }
    if (action === "remind" && method === "POST") {
      if (!["SENT", "UNPAID", "PARTIALLY_PAID"].includes(inv.status)) return invalidStatus("CANNOT_REMIND_INVOICE");
      inv._reminders += 1;
      return new Response(null, { status: 204, headers: { "paypal-debug-id": "mock-debug-remind" } });
    }
    if (action === "cancel" && method === "POST") {
      if (!["SENT", "UNPAID", "PARTIALLY_PAID"].includes(inv.status)) return invalidStatus();
      inv.status = "CANCELLED";
      return new Response(null, { status: 204 });
    }
  }
  return json(404, { name: "RESOURCE_NOT_FOUND", message: `Mock has no route for ${method} ${path}` });
}

function invalidStatus(issue = "INVALID_INVOICE_STATUS") {
  return json(422, { name: "UNPROCESSABLE_ENTITY", message: "Invalid invoice status.", details: [{ issue }] });
}

function strip(inv: PayPalInvoice & { _reminders?: number }): PayPalInvoice {
  const { _reminders: _r, ...rest } = inv;
  void _r;
  return JSON.parse(JSON.stringify(rest));
}
