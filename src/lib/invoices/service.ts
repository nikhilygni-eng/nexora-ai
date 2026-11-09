import "server-only";
import { logAudit } from "@/lib/audit";
import {
  getInvoiceByProposal,
  getInvoiceRow,
  getProposal,
  insertInvoice,
  listInvoices,
  transitionProposal,
  updateInvoice,
  upsertClient,
  type InvoiceRow,
  type ProposalRow,
} from "@/lib/db/repo";
import { getPayPal } from "@/lib/paypal";
import { PayPalApiError, PayPalNetworkError, userMessageFor } from "@/lib/paypal/errors";
import type { PayPalInvoice } from "@/lib/paypal/types";
import { isCurrencyCode, toMinor } from "@/lib/money";
import { daysBetween, NormalizedInvoiceSchema, ReminderPayloadSchema, type LocalStatus } from "./schema";

export class ApprovalConflictError extends Error {
  status = 409;
}
export class ApprovalValidationError extends Error {
  status = 422;
}
export class NotFoundError extends Error {
  status = 404;
}
export class ExecutionError extends Error {
  status = 502;
  constructor(message: string, public readonly debugId?: string) {
    super(message);
  }
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function mapPayPalStatus(ppStatus: string | null | undefined, dueDate: string, today = todayISO()): LocalStatus {
  switch (ppStatus) {
    case "DRAFT":
      return "draft";
    case "PAID":
    case "MARKED_AS_PAID":
    case "PAID_EXTERNAL":
      return "paid";
    case "PARTIALLY_PAID":
      return "partially_paid";
    case "CANCELLED":
    case "AUTO_CANCELLED":
      return "cancelled";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
    case "MARKED_AS_REFUNDED":
    case "REFUNDED_EXTERNAL":
      return "refunded";
    case "PAYMENT_PENDING":
      return "payment_pending";
    case "SENT":
    case "UNPAID":
    case "SCHEDULED":
    case "SHARED":
      return daysBetween(dueDate, today) > 0 ? "overdue" : "sent";
    default:
      return "sent";
  }
}

/** Demo rows don't sync, so derive "overdue" from the due date at read time. */
export function effectiveStatus(row: Pick<InvoiceRow, "status" | "due_date">, today = todayISO()): string {
  if ((row.status === "sent" || row.status === "partially_paid") && daysBetween(row.due_date, today) > 0) return "overdue";
  return row.status;
}

const FINAL = new Set(["paid", "cancelled", "refunded"]);
const REMINDABLE_PAYPAL = new Set(["SENT", "UNPAID", "PARTIALLY_PAID"]);

function auditPayPalError(orgId: string, action: string, err: unknown, extra: Record<string, unknown> = {}) {
  logAudit({
    orgId,
    actor: "paypal",
    action,
    paypalEndpoint: err instanceof PayPalApiError || err instanceof PayPalNetworkError ? err.endpoint : undefined,
    httpStatus: err instanceof PayPalApiError ? err.status : undefined,
    debugId: err instanceof PayPalApiError ? err.debugId : undefined,
    paypalInvoiceId: typeof extra.paypalInvoiceId === "string" ? extra.paypalInvoiceId : undefined,
    details: {
      ...extra,
      error: userMessageFor(err),
      paypal_name: err instanceof PayPalApiError ? err.paypalName : undefined,
      issues: err instanceof PayPalApiError ? err.details.map((d) => d.issue).filter(Boolean) : undefined,
    },
  });
}

function applyPayPalInvoice(orgId: string, row: InvoiceRow, pp: PayPalInvoice) {
  const cur = isCurrencyCode(pp.detail.currency_code) ? pp.detail.currency_code : row.currency;
  const safeMinor = (v?: string) => {
    if (!v) return undefined;
    try {
      return toMinor(v, cur);
    } catch {
      return undefined;
    }
  };
  const status = mapPayPalStatus(pp.status, pp.detail.payment_term?.due_date ?? row.due_date);
  const paid = safeMinor(pp.payments?.paid_amount?.value);
  const total = safeMinor(pp.amount?.value);
  updateInvoice(orgId, row.id, {
    status,
    paypal_status: pp.status,
    invoice_number: pp.detail.invoice_number ?? row.invoice_number,
    recipient_view_url: pp.detail.metadata?.recipient_view_url ?? row.recipient_view_url,
    paid_minor: paid ?? (status === "paid" ? row.total_minor : row.paid_minor),
    total_minor: total ?? row.total_minor,
    paid_at: status === "paid" && !row.paid_at ? pp.payments?.transactions?.[0]?.payment_date ?? new Date().toISOString() : row.paid_at,
    sent_at: row.sent_at ?? pp.detail.metadata?.first_sent_time ?? null,
    last_synced_at: new Date().toISOString(),
  });
  return { before: row.status, after: status, paypalStatus: pp.status };
}

/**
 * Executes an approved proposal. Called ONLY from the user-triggered approve endpoint.
 * The compare-and-set transition guarantees one execution even under concurrent clicks.
 */
export async function approveProposal(orgId: string, proposalId: string): Promise<{ proposal: ProposalRow; invoice?: InvoiceRow }> {
  const p = getProposal(orgId, proposalId);
  if (!p) throw new NotFoundError("Proposal not found");
  if (p.status === "executed") throw new ApprovalConflictError("This was already approved and sent.");
  if (p.status === "cancelled") throw new ApprovalConflictError("This proposal was cancelled.");

  if (!transitionProposal(orgId, p.id, ["pending_approval", "failed"], "executing", { incrementAttempts: true })) {
    throw new ApprovalConflictError("This proposal is already being processed.");
  }
  logAudit({ orgId, actor: "user", action: "proposal.approved", entityType: "proposal", entityId: p.id, details: { kind: p.kind, attempt: p.attempts + 1 } });

  try {
    const result = p.kind === "create_and_send_invoice" ? await executeCreateAndSend(orgId, p) : await executeReminder(orgId, p);
    transitionProposal(orgId, p.id, ["executing"], "executed", { result: result.summary, invoiceId: result.invoice?.id, error: null });
    logAudit({ orgId, actor: "system", action: "proposal.executed", entityType: "proposal", entityId: p.id, paypalInvoiceId: result.invoice?.paypal_invoice_id ?? undefined });
    return { proposal: getProposal(orgId, p.id)!, invoice: result.invoice ? getInvoiceRow(orgId, result.invoice.id) : undefined };
  } catch (err) {
    const message = userMessageFor(err);
    transitionProposal(orgId, p.id, ["executing"], "failed", { error: message });
    logAudit({ orgId, actor: "system", action: "proposal.failed", entityType: "proposal", entityId: p.id, details: { error: message } });
    if (err instanceof ApprovalValidationError) throw err;
    throw new ExecutionError(message, err instanceof PayPalApiError ? err.debugId : undefined);
  }
}

async function executeCreateAndSend(orgId: string, p: ProposalRow) {
  const parsed = NormalizedInvoiceSchema.safeParse(JSON.parse(p.payload_json));
  if (!parsed.success) throw new ApprovalValidationError("The invoice draft is invalid. Edit it and try again.");
  const inv = parsed.data;
  if (daysBetween(todayISO(), inv.due_date) < 0) throw new ApprovalValidationError("The due date is in the past. Edit the invoice first.");

  const { client: paypal, source } = getPayPal();

  // Resume after a partial failure: never create a second PayPal invoice for the same proposal.
  let row = getInvoiceByProposal(orgId, p.id);
  if (!row) {
    let created: Awaited<ReturnType<typeof paypal.createDraftInvoice>>;
    try {
      created = await paypal.createDraftInvoice(inv, `${p.idempotency_key}-create`);
    } catch (err) {
      auditPayPalError(orgId, "paypal.invoice.create_failed", err, { proposalId: p.id });
      throw err;
    }
    logAudit({
      orgId,
      actor: "paypal",
      action: "paypal.invoice.created",
      entityType: "proposal",
      entityId: p.id,
      paypalEndpoint: "POST /v2/invoicing/invoices",
      httpStatus: 201,
      debugId: created.debugId,
      paypalInvoiceId: created.invoice.id,
      details: { status: created.invoice.status, source },
    });
    const clientRow = upsertClient(orgId, { name: inv.client_name, email: inv.client_email, company: inv.client_company });
    row = insertInvoice(orgId, inv, {
      source,
      status: "draft",
      clientId: clientRow.id,
      paypalInvoiceId: created.invoice.id,
      paypalStatus: created.invoice.status,
      invoiceNumber: created.invoice.detail.invoice_number ?? null,
      proposalId: p.id,
      recipientViewUrl: created.invoice.detail.metadata?.recipient_view_url ?? null,
    });
  }

  if (row.paypal_status === "DRAFT" || row.status === "draft") {
    try {
      const sent = await paypal.sendInvoice(
        row.paypal_invoice_id!,
        { subject: `Invoice from your freelancer — due ${inv.due_date}`, note: inv.note },
        `${p.idempotency_key}-send`,
      );
      logAudit({
        orgId,
        actor: "paypal",
        action: "paypal.invoice.sent",
        entityType: "invoice",
        entityId: row.id,
        paypalEndpoint: `POST /v2/invoicing/invoices/${row.paypal_invoice_id}/send`,
        httpStatus: 200,
        debugId: sent.debugId,
        paypalInvoiceId: row.paypal_invoice_id!,
      });
      updateInvoice(orgId, row.id, {
        status: "sent",
        paypal_status: "SENT",
        sent_at: new Date().toISOString(),
        recipient_view_url: sent.link?.rel === "payer-view" ? sent.link.href : row.recipient_view_url,
      });
    } catch (err) {
      auditPayPalError(orgId, "paypal.invoice.send_failed", err, { paypalInvoiceId: row.paypal_invoice_id });
      throw err;
    }
  }

  // Confirm the real state from PayPal (source of truth). Best effort.
  const fresh = getInvoiceRow(orgId, row.id)!;
  try {
    const pp = await paypal.getInvoice(fresh.paypal_invoice_id!);
    applyPayPalInvoice(orgId, fresh, pp);
  } catch (err) {
    auditPayPalError(orgId, "paypal.invoice.sync_failed", err, { paypalInvoiceId: fresh.paypal_invoice_id });
  }
  const final = getInvoiceRow(orgId, row.id)!;
  return {
    invoice: final,
    summary: { invoice_id: final.id, paypal_invoice_id: final.paypal_invoice_id, paypal_status: final.paypal_status, source: final.source },
  };
}

async function executeReminder(orgId: string, p: ProposalRow) {
  const parsed = ReminderPayloadSchema.safeParse(JSON.parse(p.payload_json));
  if (!parsed.success) throw new ApprovalValidationError("The reminder draft is invalid. Edit it and try again.");
  const r = parsed.data;
  const row = getInvoiceRow(orgId, r.invoice_id);
  if (!row || row.paypal_invoice_id !== r.paypal_invoice_id) throw new ApprovalValidationError("The invoice for this reminder no longer exists.");
  if (row.source === "demo") throw new ApprovalValidationError("Demo invoices aren't in PayPal, so reminders can't be sent for them.");

  const { client: paypal } = getPayPal();
  // Refresh status first so we never remind a paid invoice.
  const pp = await paypal.getInvoice(row.paypal_invoice_id!);
  applyPayPalInvoice(orgId, row, pp);
  if (!REMINDABLE_PAYPAL.has(pp.status)) {
    throw new ApprovalValidationError(`PayPal shows this invoice as ${pp.status}, so no reminder was sent.`);
  }
  try {
    const res = await paypal.remindInvoice(row.paypal_invoice_id!, { subject: r.subject, note: r.note }, `${p.idempotency_key}-remind`);
    logAudit({
      orgId,
      actor: "paypal",
      action: "paypal.invoice.reminded",
      entityType: "invoice",
      entityId: row.id,
      paypalEndpoint: `POST /v2/invoicing/invoices/${row.paypal_invoice_id}/remind`,
      httpStatus: 204,
      debugId: res.debugId,
      paypalInvoiceId: row.paypal_invoice_id!,
    });
  } catch (err) {
    auditPayPalError(orgId, "paypal.invoice.remind_failed", err, { paypalInvoiceId: row.paypal_invoice_id });
    throw err;
  }
  updateInvoice(orgId, row.id, { last_reminded_at: new Date().toISOString() });
  return { invoice: getInvoiceRow(orgId, row.id)!, summary: { reminded: row.paypal_invoice_id } };
}

export function cancelProposal(orgId: string, proposalId: string) {
  const p = getProposal(orgId, proposalId);
  if (!p) throw new NotFoundError("Proposal not found");
  if (!transitionProposal(orgId, p.id, ["pending_approval", "failed"], "cancelled")) {
    throw new ApprovalConflictError("Only proposals awaiting approval can be cancelled.");
  }
  logAudit({ orgId, actor: "user", action: "proposal.cancelled", entityType: "proposal", entityId: p.id });
  return getProposal(orgId, p.id)!;
}

/** Pull the latest state of one invoice from PayPal. */
export async function syncInvoice(orgId: string, invoiceId: string) {
  const row = getInvoiceRow(orgId, invoiceId);
  if (!row) throw new NotFoundError("Invoice not found");
  if (row.source === "demo" || !row.paypal_invoice_id) return { row, changed: false, skipped: "demo" as const };
  const { client: paypal } = getPayPal();
  try {
    const pp = await paypal.getInvoice(row.paypal_invoice_id);
    const r = applyPayPalInvoice(orgId, row, pp);
    logAudit({
      orgId,
      actor: "paypal",
      action: r.before !== r.after ? "paypal.invoice.status_changed" : "paypal.invoice.synced",
      entityType: "invoice",
      entityId: row.id,
      paypalEndpoint: `GET /v2/invoicing/invoices/${row.paypal_invoice_id}`,
      httpStatus: 200,
      paypalInvoiceId: row.paypal_invoice_id,
      details: { from: r.before, to: r.after, paypal_status: r.paypalStatus },
    });
    return { row: getInvoiceRow(orgId, row.id)!, changed: r.before !== r.after };
  } catch (err) {
    auditPayPalError(orgId, "paypal.invoice.sync_failed", err, { paypalInvoiceId: row.paypal_invoice_id });
    throw new ExecutionError(userMessageFor(err), err instanceof PayPalApiError ? err.debugId : undefined);
  }
}

/** Sync all open PayPal invoices, throttled per invoice. */
export async function syncOpenInvoices(orgId: string, minIntervalMs = 15000) {
  const open = listInvoices(orgId).filter(
    (r) => r.source !== "demo" && r.paypal_invoice_id && !FINAL.has(r.status) &&
      (!r.last_synced_at || Date.now() - Date.parse(r.last_synced_at) > minIntervalMs),
  );
  const results: { id: string; changed: boolean; error?: string }[] = [];
  for (const r of open.slice(0, 20)) {
    try {
      const s = await syncInvoice(orgId, r.id);
      results.push({ id: r.id, changed: s.changed });
    } catch (e) {
      results.push({ id: r.id, changed: false, error: (e as Error).message });
    }
  }
  return results;
}

export function isRemindable(row: InvoiceRow) {
  return row.source !== "demo" && !!row.paypal_invoice_id && REMINDABLE_PAYPAL.has(row.paypal_status ?? "");
}
