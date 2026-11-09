import type { NormalizedInvoice } from "@/lib/invoices/schema";
import { fromMinor, milliToPercentString } from "@/lib/money";
import { PayPalApiError, PayPalNetworkError, type PayPalErrorDetail } from "./errors";
import type { PayPalInvoice, PayPalLink } from "./types";

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type PayPalCallRecord = {
  method: string;
  endpoint: string; // path only, no host, no secrets
  status: number;
  debugId?: string;
  requestId?: string;
  durationMs: number;
};

export type PayPalClientOptions = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
  onCall?: (rec: PayPalCallRecord) => void;
};

type Token = { value: string; expiresAt: number };

export class PayPalClient {
  private token: Token | null = null;
  private tokenPromise: Promise<Token> | null = null;
  private readonly fetcher: Fetcher;

  constructor(private readonly opts: PayPalClientOptions) {
    this.fetcher = opts.fetcher ?? ((i, init) => fetch(i, init));
  }

  /** OAuth2 client-credentials token, cached until 60s before expiry, with in-flight de-duplication. */
  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    if (!this.tokenPromise) {
      this.tokenPromise = this.fetchToken().finally(() => {
        this.tokenPromise = null;
      });
    }
    this.token = await this.tokenPromise;
    return this.token.value;
  }

  private async fetchToken(): Promise<Token> {
    const endpoint = "/v1/oauth2/token";
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64");
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetcher(this.opts.baseUrl + endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20000),
      });
    } catch (e) {
      throw new PayPalNetworkError(`Token request failed: ${(e as Error).message}`, endpoint);
    }
    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    this.opts.onCall?.({ method: "POST", endpoint, status: res.status, debugId, durationMs: Date.now() - started });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new PayPalApiError(res.status, json.error, json.error_description, debugId, [], endpoint);
    }
    const ttl = Math.max(60, Number(json.expires_in ?? 300));
    return { value: json.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  }

  async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    endpoint: string,
    opts: { body?: unknown; requestId?: string; prefer?: string; retryOn401?: boolean } = {},
  ): Promise<{ status: number; data: T | null; debugId?: string }> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    if (opts.prefer) headers["Prefer"] = opts.prefer;

    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetcher(this.opts.baseUrl + endpoint, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20000),
      });
    } catch (e) {
      const msg = (e as Error).name === "TimeoutError" ? "Request timed out" : (e as Error).message;
      throw new PayPalNetworkError(msg, endpoint);
    }
    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    this.opts.onCall?.({
      method,
      endpoint,
      status: res.status,
      debugId,
      requestId: opts.requestId,
      durationMs: Date.now() - started,
    });

    if (res.status === 401 && opts.retryOn401 !== false) {
      this.token = null;
      return this.request<T>(method, endpoint, { ...opts, retryOn401: false });
    }

    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!res.ok) {
      const err = (data ?? {}) as { name?: string; message?: string; debug_id?: string; details?: PayPalErrorDetail[] };
      throw new PayPalApiError(res.status, err.name, err.message, err.debug_id ?? debugId, err.details ?? [], endpoint);
    }
    return { status: res.status, data: data as T, debugId };
  }

  /** POST /v2/invoicing/invoices — creates a DRAFT invoice. */
  async createDraftInvoice(inv: NormalizedInvoice, requestId: string): Promise<{ invoice: PayPalInvoice; debugId?: string }> {
    const res = await this.request<PayPalInvoice | PayPalLink>("POST", "/v2/invoicing/invoices", {
      body: buildInvoiceBody(inv),
      requestId,
      prefer: "return=representation",
    });
    const data = res.data;
    if (data && "id" in data && data.id) return { invoice: data as PayPalInvoice, debugId: res.debugId };
    // Some API versions return only a link to the created resource.
    const href = (data as PayPalLink | null)?.href;
    const id = href?.split("/").pop();
    if (!id) throw new PayPalApiError(res.status, "UNEXPECTED_RESPONSE", "Create returned no invoice id", res.debugId, [], "/v2/invoicing/invoices");
    return { invoice: await this.getInvoice(id), debugId: res.debugId };
  }

  /** POST /v2/invoicing/invoices/{id}/send */
  async sendInvoice(
    id: string,
    n: { subject?: string; note?: string; sendToRecipient?: boolean; sendToInvoicer?: boolean },
    requestId: string,
  ): Promise<{ link?: PayPalLink; debugId?: string }> {
    const res = await this.request<PayPalLink>("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, {
      body: {
        subject: n.subject,
        note: n.note,
        send_to_recipient: n.sendToRecipient ?? true,
        send_to_invoicer: n.sendToInvoicer ?? true,
      },
      requestId,
    });
    return { link: res.data ?? undefined, debugId: res.debugId };
  }

  /** GET /v2/invoicing/invoices/{id} */
  async getInvoice(id: string): Promise<PayPalInvoice> {
    const res = await this.request<PayPalInvoice>("GET", `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
    if (!res.data) throw new PayPalApiError(res.status, "EMPTY", "Empty invoice response", res.debugId, [], "get");
    return res.data;
  }

  /** POST /v2/invoicing/invoices/{id}/remind → 204 */
  async remindInvoice(id: string, n: { subject: string; note: string }, requestId: string): Promise<{ debugId?: string }> {
    const res = await this.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, {
      body: { subject: n.subject, note: n.note, send_to_recipient: true, send_to_invoicer: true },
      requestId,
    });
    return { debugId: res.debugId };
  }

  /** POST /v2/invoicing/invoices/{id}/cancel → 204 */
  async cancelInvoice(id: string, n: { subject?: string; note?: string }, requestId: string): Promise<{ debugId?: string }> {
    const res = await this.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
      body: { subject: n.subject, note: n.note, send_to_recipient: true, send_to_invoicer: true },
      requestId,
    });
    return { debugId: res.debugId };
  }

  /** POST /v1/notifications/verify-webhook-signature */
  async verifyWebhookSignature(input: {
    headers: Record<string, string | null>;
    webhookId: string;
    event: unknown;
  }): Promise<boolean> {
    const h = input.headers;
    const res = await this.request<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      body: {
        auth_algo: h["paypal-auth-algo"],
        cert_url: h["paypal-cert-url"],
        transmission_id: h["paypal-transmission-id"],
        transmission_sig: h["paypal-transmission-sig"],
        transmission_time: h["paypal-transmission-time"],
        webhook_id: input.webhookId,
        webhook_event: input.event,
      },
    });
    return res.data?.verification_status === "SUCCESS";
  }
}

/** Maps our normalized invoice to the PayPal Invoicing v2 `invoice` schema. */
export function buildInvoiceBody(inv: NormalizedInvoice) {
  return {
    detail: {
      currency_code: inv.currency,
      invoice_date: inv.issue_date,
      payment_term: { due_date: inv.due_date },
      note: inv.note,
      memo: "Created with NEXORA AI (sandbox)",
    },
    primary_recipients: [
      {
        billing_info: {
          name: { full_name: inv.client_name },
          email_address: inv.client_email,
          ...(inv.client_company ? { business_name: inv.client_company } : {}),
        },
      },
    ],
    items: inv.items.map((it) => ({
      name: it.name,
      ...(it.description ? { description: it.description } : {}),
      quantity: it.quantity,
      unit_amount: { currency_code: inv.currency, value: fromMinor(it.unit_minor, inv.currency) },
      ...(it.tax_milli > 0 ? { tax: { name: inv.tax_name, percent: milliToPercentString(it.tax_milli) } } : {}),
      unit_of_measure: "QUANTITY",
    })),
  };
}
