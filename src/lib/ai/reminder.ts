import "server-only";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { getOrg, insertProposal, type InvoiceRow } from "@/lib/db/repo";
import { daysBetween } from "@/lib/invoices/schema";
import { todayISO } from "@/lib/invoices/service";
import { formatMoney } from "@/lib/money";
import { getAIProvider } from ".";
import { AIProviderError, extractJson } from "./provider";

const ReminderDraft = z.object({ subject: z.string().trim().min(3).max(200), note: z.string().trim().min(10).max(1200) });

/** AI writes the reminder text; it becomes a proposal the user must approve before PayPal sends it. */
export async function draftReminderProposal(orgId: string, row: InvoiceRow, tone: "friendly" | "firm" = "friendly") {
  const org = getOrg(orgId);
  const late = daysBetween(row.due_date, todayISO());
  const facts = {
    from: org.name,
    client: row.client_name,
    invoice_number: row.invoice_number ?? row.paypal_invoice_id,
    amount_due: formatMoney(Math.max(0, row.total_minor - row.paid_minor), row.currency),
    due_date: row.due_date,
    days_overdue: Math.max(0, late),
    previously_reminded: row.last_reminded_at ? row.last_reminded_at.slice(0, 10) : "never",
    tone,
  };
  const res = await getAIProvider().generate({
    system:
      "Write a short payment reminder email that PayPal will deliver with the invoice link. Use only the facts given. " +
      "Subject under 80 characters. Note under 110 words, warm but clear, includes amount, invoice number and due date, no placeholders, no signature line. Return JSON {subject, note}.",
    messages: [{ role: "user", text: JSON.stringify(facts) }],
    jsonSchema: {
      name: "reminder",
      schema: { type: "object", properties: { subject: { type: "string" }, note: { type: "string" } }, required: ["subject", "note"] },
    },
    temperature: 0.4,
  });
  if (!res.text) throw new AIProviderError("malformed", "Empty reminder");
  const parsed = ReminderDraft.safeParse(extractJson(res.text));
  if (!parsed.success) throw new AIProviderError("malformed", "Reminder failed validation");
  const proposal = insertProposal(orgId, {
    kind: "send_reminder",
    payload: { invoice_id: row.id, paypal_invoice_id: row.paypal_invoice_id, ...parsed.data },
    invoiceId: row.id,
  });
  logAudit({ orgId, actor: "ai", action: "proposal.created", entityType: "proposal", entityId: proposal.id, paypalInvoiceId: row.paypal_invoice_id ?? undefined, details: { kind: "send_reminder", tone } });
  return proposal;
}
