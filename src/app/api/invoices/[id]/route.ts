import type { NextRequest } from "next/server";
import { apiError, json, requireSession } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getInvoiceRow, listProposals } from "@/lib/db/repo";
import { invoiceDTO, proposalDTO } from "@/lib/views";
import type { AuditRow } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireSession();
    const id = (await params).id;
    const row = getInvoiceRow(orgId, id);
    if (!row) return json({ error: { code: "not_found", message: "Invoice not found" } }, { status: 404 });
    const activity = getDb()
      .prepare(
        `SELECT * FROM audit_log WHERE org_id = ? AND ((entity_type='invoice' AND entity_id = ?) OR (paypal_invoice_id IS NOT NULL AND paypal_invoice_id = ?) OR (entity_type='proposal' AND entity_id = ?))
         ORDER BY id DESC LIMIT 50`,
      )
      .all(orgId, id, row.paypal_invoice_id ?? "", row.proposal_id ?? "") as AuditRow[];
    const reminders = listProposals(orgId).filter((p) => p.invoice_id === id && p.kind === "send_reminder").map(proposalDTO);
    return json({ invoice: invoiceDTO(row), activity, reminders });
  } catch (e) {
    return apiError(e);
  }
}
