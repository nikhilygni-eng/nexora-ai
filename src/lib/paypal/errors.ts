export type PayPalErrorDetail = { field?: string; issue?: string; description?: string; value?: string };

export class PayPalApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly paypalName: string | undefined,
    public readonly paypalMessage: string | undefined,
    public readonly debugId: string | undefined,
    public readonly details: PayPalErrorDetail[],
    public readonly endpoint: string,
  ) {
    super(`PayPal ${status} ${paypalName ?? ""} on ${endpoint}${debugId ? ` (debug_id ${debugId})` : ""}`.trim());
    this.name = "PayPalApiError";
  }

  /** Short, human message for the UI. Never includes secrets. */
  get userMessage(): string {
    return mapPayPalError(this);
  }
}

export class PayPalNetworkError extends Error {
  constructor(message: string, public readonly endpoint: string) {
    super(message);
    this.name = "PayPalNetworkError";
  }
  get userMessage() {
    return "Couldn't reach PayPal Sandbox. Check your connection and try again — nothing was charged or sent twice.";
  }
}

export class PayPalConfigError extends Error {
  get userMessage() {
    return this.message;
  }
}

const ISSUE_MESSAGES: Record<string, string> = {
  INVALID_CURRENCY_CODE: "PayPal doesn't accept that currency code.",
  CURRENCY_NOT_SUPPORTED: "This currency isn't supported for invoicing on this PayPal account.",
  INVALID_EMAIL_ADDRESS: "The client's email address was rejected by PayPal.",
  INVALID_DUE_DATE: "The due date was rejected by PayPal. Pick a date on or after today.",
  DUPLICATE_INVOICE_NUMBER: "That invoice number already exists in PayPal.",
  INVALID_INVOICE_STATUS: "PayPal won't allow that action for the invoice's current status.",
  CANNOT_REMIND_INVOICE: "PayPal won't send a reminder for this invoice in its current status.",
  PERMISSION_DENIED: "This PayPal app doesn't have the Invoicing permission enabled.",
  NOT_AUTHORIZED: "This PayPal app isn't authorized for that action. Enable Invoicing for the Sandbox app.",
};

export function mapPayPalError(e: PayPalApiError): string {
  const issue = e.details.find((d) => d.issue)?.issue;
  if (issue && ISSUE_MESSAGES[issue]) return ISSUE_MESSAGES[issue];
  if (e.status === 401) return "PayPal rejected the app credentials. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local.";
  if (e.status === 403) return "PayPal refused the request. Make sure Invoicing is enabled for your Sandbox REST app.";
  if (e.status === 404) return "PayPal couldn't find that invoice.";
  if (e.status === 409) return "PayPal reports a conflicting request (it may already have been processed).";
  if (e.status === 422 || e.status === 400) {
    const d = e.details.find((x) => x.description)?.description ?? e.paypalMessage;
    return d ? `PayPal rejected the invoice: ${d}` : "PayPal rejected the request as invalid.";
  }
  if (e.status === 429) return "PayPal is rate-limiting requests. Wait a few seconds and try again.";
  if (e.status >= 500) return "PayPal Sandbox had a temporary error. Try again in a moment.";
  return e.paypalMessage ?? "PayPal returned an unexpected error.";
}

export function userMessageFor(err: unknown): string {
  if (err instanceof PayPalApiError || err instanceof PayPalNetworkError || err instanceof PayPalConfigError) return err.userMessage;
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}
