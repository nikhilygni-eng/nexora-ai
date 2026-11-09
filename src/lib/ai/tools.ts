import "server-only";
import { z } from "zod";
import { computeFacts } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import {
  findClients,
  getOrg,
  getClientByEmail,
  insertProposal,
  listInvoices,
  resolveInvoiceRef,
  type InvoiceRow,
} from "@/lib/db/repo";
import { daysBetween, normalizeInvoiceDraft, InvoiceDraftInputSchema } from "@/lib/invoices/schema";
import { effectiveStatus, isRemindable, syncInvoice, todayISO } from "@/lib/invoices/service";
import { formatMoney, CURRENCY_CODES } from "@/lib/money";
import type { JSONSchema, ToolSpec } from "./provider";

export type ToolContext = {
  orgId: string;
  conversationId: string;
  /** Every user message in this conversation; used to verify emails were supplied by the user. */
  userTexts: string[];
  createdProposalIds: string[];
};

export type ToolDef<A> = ToolSpec & {
  readOnly: boolean;
  args: z.ZodType<A>;
  run: (ctx: ToolContext, args: A) => Promise<unknown>;
};

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

function invoiceSummary(r: InvoiceRow) {
  const status = effectiveStatus(r);
  return {
    id: r.id,
    paypal_invoice_id: r.paypal_invoice_id,
    invoice_number: r.invoice_number,
    source: r.source,
    client: r.client_name,
    client_email: r.client_email,
    total: formatMoney(r.total_minor, r.currency),
    outstanding: formatMoney(Math.max(0, r.total_minor - r.paid_minor), r.currency),
    status,
    paypal_status: r.paypal_status,
    due_date: r.due_date,
    days_overdue: status === "overdue" ? daysBetween(r.due_date, todayISO()) : 0,
    last_reminded_at: r.last_reminded_at,
    can_remind: isRemindable(r),
  };
}

const moneyish: JSONSchema = { type: ["string", "number"], description: "Decimal amount, e.g. \"800\" or \"1250.50\"" };

const draftInvoice: ToolDef<z.infer<typeof InvoiceDraftInputSchema>> = {
  name: "draft_invoice",
  description:
    "Validate an invoice and create a DRAFT PROPOSAL the user must approve. This does NOT contact PayPal or send anything. " +
    "Only pass client_email if the user wrote it or find_client returned it. If fields are missing, the result lists them; ask the user.",
  readOnly: false,
  parameters: {
    type: "object",
    properties: {
      client_name: { type: "string", description: "Client or company name as the user wrote it" },
      client_email: { type: "string", description: "Billing email. Never guess or construct one." },
      client_company: { type: "string" },
      currency: { type: "string", enum: CURRENCY_CODES, description: "ISO 4217 code. Omit to use the workspace default." },
      items: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            quantity: { ...moneyish, description: "Defaults to 1" },
            unit_amount: moneyish,
          },
          required: ["name", "unit_amount"],
        },
      },
      tax_percent: { ...moneyish, description: "Percent, e.g. 18. Omit to use the workspace default tax." },
      tax_name: { type: "string", description: "e.g. GST, VAT. Omit to use the workspace default." },
      due_date: { type: "string", description: "YYYY-MM-DD. Use either due_date or due_in_days." },
      due_in_days: { type: "integer", description: "Days from today" },
      note: { type: "string", description: "Short note shown to the client" },
    },
    required: ["client_name", "items"],
  },
  args: InvoiceDraftInputSchema,
  async run(ctx, args) {
    const org = getOrg(ctx.orgId);
    const result = normalizeInvoiceDraft(args, {
      currency: org.default_currency,
      taxName: org.default_tax_name,
      taxMilli: org.default_tax_milli,
      termsDays: org.default_terms_days,
      today: todayISO(),
    });

    // Anti-hallucination guard: the email must come from the user or a saved client.
    if (args.client_email) {
      const email = args.client_email.trim().toLowerCase();
      const typed = ctx.userTexts.join("\n").match(EMAIL_IN_TEXT)?.map((e) => e.toLowerCase()) ?? [];
      const known = getClientByEmail(ctx.orgId, email);
      if (!typed.includes(email) && !known) {
        return {
          ok: false,
          missing: ["client_email"],
          error: `The email "${args.client_email}" was not provided by the user and is not a saved client. Ask the user for ${args.client_name}'s billing email. Do not guess.`,
        };
      }
    }
    if (!result.ok) {
      return {
        ok: false,
        missing: result.missing,
        errors: result.errors,
        instruction: result.missing.length
          ? `Ask the user for: ${result.missing.join(", ")}. Then call draft_invoice again.`
          : "Explain the problem to the user and ask how to fix it.",
      };
    }
    const proposal = insertProposal(ctx.orgId, {
      kind: "create_and_send_invoice",
      payload: result.invoice,
      conversationId: ctx.conversationId,
    });
    ctx.createdProposalIds.push(proposal.id);
    logAudit({
      orgId: ctx.orgId,
      actor: "ai",
      action: "proposal.created",
      entityType: "proposal",
      entityId: proposal.id,
      details: { kind: proposal.kind, client: result.invoice.client_name, total_minor: result.invoice.total_minor, currency: result.invoice.currency },
    });
    const inv = result.invoice;
    return {
      ok: true,
      proposal_id: proposal.id,
      status: "pending_approval",
      summary: {
        client: inv.client_name,
        email: inv.client_email,
        total: formatMoney(inv.total_minor, inv.currency),
        tax: `${inv.tax_name} ${inv.tax_milli / 1000}%`,
        due_date: inv.due_date,
        items: inv.items.length,
      },
      instruction: "Tell the user the draft is ready for review. It is NOT sent until they click Approve on the card.",
    };
  },
};

const findClientTool: ToolDef<{ query: string }> = {
  name: "find_client",
  description: "Search saved clients by name, company or email. Use this to look up a billing email before asking the user.",
  readOnly: true,
  parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  args: z.object({ query: z.string().trim().min(1).max(120) }),
  async run(ctx, { query }) {
    const words = query.split(/\s+/).filter((w) => w.length > 2);
    const seen = new Map<string, ReturnType<typeof findClients>[number]>();
    for (const q of [query, ...words]) for (const c of findClients(ctx.orgId, q)) seen.set(c.id, c);
    const matches = [...seen.values()].slice(0, 5).map((c) => ({ name: c.name, company: c.company, email: c.email, demo: c.source === "demo" }));
    return { matches, count: matches.length };
  },
};

const listInvoicesTool: ToolDef<{ status?: string; client?: string; limit?: number }> = {
  name: "list_invoices",
  description: "List invoices from the database, optionally filtered by status (draft, sent, overdue, paid, partially_paid, cancelled) or client.",
  readOnly: true,
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["draft", "sent", "overdue", "paid", "partially_paid", "cancelled", "refunded", "payment_pending"] },
      client: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 25 },
    },
  },
  args: z.object({ status: z.string().optional(), client: z.string().optional(), limit: z.number().int().min(1).max(25).optional() }),
  async run(ctx, a) {
    let rows = listInvoices(ctx.orgId, { client: a.client, limit: 200 });
    if (a.status) rows = rows.filter((r) => effectiveStatus(r) === a.status);
    return { invoices: rows.slice(0, a.limit ?? 10).map(invoiceSummary), total_matching: rows.length };
  },
};

const getInvoiceStatus: ToolDef<{ invoice_ref?: string; client?: string }> = {
  name: "get_invoice_status",
  description: "Get the live status of one invoice. For PayPal invoices this fetches the latest status from PayPal (read-only).",
  readOnly: true,
  parameters: {
    type: "object",
    properties: {
      invoice_ref: { type: "string", description: "Our id, PayPal invoice id, or invoice number" },
      client: { type: "string", description: "Client name; returns their most recent invoice" },
    },
  },
  args: z.object({ invoice_ref: z.string().optional(), client: z.string().optional() }),
  async run(ctx, a) {
    let row = a.invoice_ref ? resolveInvoiceRef(ctx.orgId, a.invoice_ref) : undefined;
    if (!row && a.client) row = listInvoices(ctx.orgId, { client: a.client, limit: 1 })[0];
    if (!row) return { found: false, message: "No matching invoice." };
    let synced = false;
    let syncError: string | undefined;
    if (row.source !== "demo" && row.paypal_invoice_id) {
      try {
        row = (await syncInvoice(ctx.orgId, row.id)).row;
        synced = true;
      } catch (e) {
        syncError = (e as Error).message;
      }
    }
    return { found: true, invoice: invoiceSummary(row), synced_from_paypal: synced, sync_error: syncError };
  },
};

const summarize: ToolDef<{ include_demo?: boolean }> = {
  name: "summarize_receivables",
  description: "Compute receivables facts (outstanding, overdue, aging, top debtors, avg days to pay) from the database.",
  readOnly: true,
  parameters: { type: "object", properties: { include_demo: { type: "boolean", description: "Include rows labeled demo data. Default true." } } },
  args: z.object({ include_demo: z.boolean().optional() }),
  async run(ctx, a) {
    const f = computeFacts(ctx.orgId, { includeDemo: a.include_demo ?? true });
    const c = f.primary_currency;
    const m = (v: number) => formatMoney(v, c);
    return {
      currency: c,
      scope: f.scope,
      outstanding: m(f.totals.outstanding_minor),
      overdue: m(f.totals.overdue_minor),
      overdue_count: f.totals.overdue_count,
      open_count: f.totals.open_count,
      collected: m(f.totals.collected_minor),
      avg_days_to_pay: f.avg_days_to_pay,
      aging: f.aging.map((b) => ({ bucket: b.bucket, amount: m(b.minor), count: b.count })),
      top_clients_outstanding: f.top_clients_outstanding.map((t) => ({ ...t, minor: undefined, amount: m(t.minor) })),
      estimate_next_30d: { amount: m(f.estimate_next_30d_collections_minor), label: "Estimate" },
      note: f.scope.demo_count ? "Some rows are demo data; say so when citing totals." : undefined,
    };
  },
};

const draftReminder: ToolDef<{ invoice_ref: string; subject: string; note: string }> = {
  name: "draft_reminder",
  description:
    "Create a payment-reminder PROPOSAL for an unpaid PayPal invoice. You write the subject and note (polite, specific, mentions amount and due date). " +
    "Nothing is sent until the user approves. Only works for PayPal invoices (not demo data).",
  readOnly: false,
  parameters: {
    type: "object",
    properties: {
      invoice_ref: { type: "string", description: "Our id, PayPal invoice id, or invoice number (from list_invoices)" },
      subject: { type: "string" },
      note: { type: "string", description: "Reminder message body, under 120 words" },
    },
    required: ["invoice_ref", "subject", "note"],
  },
  args: z.object({ invoice_ref: z.string().min(1), subject: z.string().trim().min(3).max(200), note: z.string().trim().min(10).max(4000) }),
  async run(ctx, a) {
    const row = resolveInvoiceRef(ctx.orgId, a.invoice_ref);
    if (!row) return { ok: false, error: "Invoice not found. Use list_invoices to find the right id." };
    if (row.source === "demo") return { ok: false, error: "That invoice is demo data and isn't in PayPal, so a reminder can't be sent." };
    if (!isRemindable(row)) return { ok: false, error: `PayPal status is ${row.paypal_status}; reminders are only possible for sent, unpaid invoices.` };
    const proposal = insertProposal(ctx.orgId, {
      kind: "send_reminder",
      payload: { invoice_id: row.id, paypal_invoice_id: row.paypal_invoice_id, subject: a.subject, note: a.note },
      conversationId: ctx.conversationId,
      invoiceId: row.id,
    });
    ctx.createdProposalIds.push(proposal.id);
    logAudit({ orgId: ctx.orgId, actor: "ai", action: "proposal.created", entityType: "proposal", entityId: proposal.id, paypalInvoiceId: row.paypal_invoice_id ?? undefined, details: { kind: "send_reminder" } });
    return { ok: true, proposal_id: proposal.id, status: "pending_approval", instruction: "Tell the user the reminder is drafted and waits for their approval." };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: ToolDef<any>[] = [draftInvoice, findClientTool, listInvoicesTool, getInvoiceStatus, summarize, draftReminder];

export const TOOL_LABELS: Record<string, string> = {
  draft_invoice: "Drafted invoice",
  find_client: "Searched clients",
  list_invoices: "Listed invoices",
  get_invoice_status: "Checked invoice status",
  summarize_receivables: "Summarized receivables",
  draft_reminder: "Drafted reminder",
};

export const TOOL_FAIL_LABELS: Record<string, string> = {
  draft_invoice: "Draft needs details",
  draft_reminder: "Reminder not possible",
  get_invoice_status: "Status check failed",
};
