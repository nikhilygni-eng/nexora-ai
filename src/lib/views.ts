import "server-only";
import { getInvoiceRow, toView, type InvoiceRow, type ProposalRow } from "@/lib/db/repo";
import { effectiveStatus, isRemindable } from "@/lib/invoices/service";
import { toDraftInput, type NormalizedInvoice } from "@/lib/invoices/schema";

export type InvoiceDTO = ReturnType<typeof invoiceDTO>;

export function invoiceDTO(r: InvoiceRow) {
  const v = toView(r);
  return {
    ...v,
    status: effectiveStatus(r),
    outstanding_minor: Math.max(0, r.total_minor - r.paid_minor),
    can_remind: isRemindable(r),
  };
}

export type ProposalDTO = ReturnType<typeof proposalDTO>;

export function proposalDTO(p: ProposalRow) {
  const payload = JSON.parse(p.payload_json);
  const inv = p.invoice_id ? getInvoiceRow(p.org_id, p.invoice_id) : undefined;
  return {
    id: p.id,
    kind: p.kind,
    status: p.status,
    attempts: p.attempts,
    error: p.error,
    created_at: p.created_at,
    executed_at: p.executed_at,
    conversation_id: p.conversation_id,
    invoice: p.kind === "create_and_send_invoice" ? (payload as NormalizedInvoice) : undefined,
    draft: p.kind === "create_and_send_invoice" ? toDraftInput(payload as NormalizedInvoice) : undefined,
    reminder: p.kind === "send_reminder" ? (payload as { subject: string; note: string; invoice_id: string; paypal_invoice_id: string }) : undefined,
    result_invoice: inv ? invoiceDTO(inv) : undefined,
  };
}
