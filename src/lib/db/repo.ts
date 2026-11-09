import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { NormalizedInvoice, NormalizedItem } from "@/lib/invoices/schema";
import type { CurrencyCode } from "@/lib/money";

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const now = () => new Date().toISOString();

/* ---------------- Orgs / settings ---------------- */

export type OrgRow = {
  id: string;
  name: string;
  business_email: string | null;
  default_currency: CurrencyCode;
  default_tax_name: string;
  default_tax_milli: number;
  default_terms_days: number;
};

export function getOrg(orgId: string): OrgRow {
  const row = getDb().prepare("SELECT * FROM orgs WHERE id = ?").get(orgId) as OrgRow | undefined;
  if (!row) throw new Error("Workspace not found");
  return row;
}

export function updateOrg(orgId: string, patch: Partial<Omit<OrgRow, "id">>) {
  const cur = getOrg(orgId);
  const next = { ...cur, ...patch };
  getDb()
    .prepare(
      `UPDATE orgs SET name=?, business_email=?, default_currency=?, default_tax_name=?, default_tax_milli=?, default_terms_days=? WHERE id=?`,
    )
    .run(next.name, next.business_email, next.default_currency, next.default_tax_name, next.default_tax_milli, next.default_terms_days, orgId);
  return getOrg(orgId);
}

/* ---------------- Clients ---------------- */

export type ClientRow = {
  id: string;
  org_id: string;
  name: string;
  company: string | null;
  email: string;
  country: string | null;
  source: string;
  created_at: string;
};

export function findClients(orgId: string, query: string, limit = 5): ClientRow[] {
  const q = `%${query.trim().toLowerCase()}%`;
  return getDb()
    .prepare(
      `SELECT * FROM clients WHERE org_id = ? AND (lower(name) LIKE ? OR lower(coalesce(company,'')) LIKE ? OR lower(email) LIKE ?)
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(orgId, q, q, q, limit) as ClientRow[];
}

export function getClientByEmail(orgId: string, email: string): ClientRow | undefined {
  return getDb().prepare("SELECT * FROM clients WHERE org_id = ? AND email = ?").get(orgId, email.toLowerCase()) as
    | ClientRow
    | undefined;
}

export function listClients(orgId: string): ClientRow[] {
  return getDb().prepare("SELECT * FROM clients WHERE org_id = ? ORDER BY name").all(orgId) as ClientRow[];
}

export function upsertClient(
  orgId: string,
  c: { name: string; email: string; company?: string | null; country?: string | null; source?: string },
): ClientRow {
  const existing = getClientByEmail(orgId, c.email);
  if (existing) {
    getDb()
      .prepare("UPDATE clients SET name = ?, company = coalesce(?, company) WHERE id = ?")
      .run(c.name, c.company ?? null, existing.id);
    return getClientByEmail(orgId, c.email)!;
  }
  const id = newId("cli");
  getDb()
    .prepare("INSERT INTO clients (id, org_id, name, company, email, country, source, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, orgId, c.name, c.company ?? null, c.email.toLowerCase(), c.country ?? null, c.source ?? "user", now());
  return getClientByEmail(orgId, c.email)!;
}

/* ---------------- Invoices ---------------- */

export type InvoiceSource = "demo" | "paypal_sandbox" | "mock_paypal";

export type InvoiceRow = {
  id: string;
  org_id: string;
  client_id: string | null;
  source: InvoiceSource;
  status: string;
  paypal_invoice_id: string | null;
  paypal_status: string | null;
  invoice_number: string | null;
  client_name: string;
  client_email: string;
  currency: CurrencyCode;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  paid_minor: number;
  issue_date: string;
  due_date: string;
  note: string | null;
  items_json: string;
  recipient_view_url: string | null;
  proposal_id: string | null;
  sent_at: string | null;
  paid_at: string | null;
  last_reminded_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceView = Omit<InvoiceRow, "items_json"> & { items: NormalizedItem[] };

export function toView(r: InvoiceRow): InvoiceView {
  const { items_json, ...rest } = r;
  return { ...rest, items: JSON.parse(items_json) as NormalizedItem[] };
}

export function insertInvoice(
  orgId: string,
  inv: NormalizedInvoice,
  extra: {
    source: InvoiceSource;
    status: string;
    clientId?: string | null;
    paypalInvoiceId?: string | null;
    paypalStatus?: string | null;
    invoiceNumber?: string | null;
    proposalId?: string | null;
    recipientViewUrl?: string | null;
    paidMinor?: number;
    sentAt?: string | null;
    paidAt?: string | null;
    createdAt?: string;
  },
): InvoiceRow {
  const id = newId("inv");
  const ts = extra.createdAt ?? now();
  getDb()
    .prepare(
      `INSERT INTO invoices (id, org_id, client_id, source, status, paypal_invoice_id, paypal_status, invoice_number, client_name, client_email,
        currency, subtotal_minor, tax_minor, total_minor, paid_minor, issue_date, due_date, note, items_json, recipient_view_url, proposal_id,
        sent_at, paid_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      orgId,
      extra.clientId ?? null,
      extra.source,
      extra.status,
      extra.paypalInvoiceId ?? null,
      extra.paypalStatus ?? null,
      extra.invoiceNumber ?? null,
      inv.client_name,
      inv.client_email,
      inv.currency,
      inv.subtotal_minor,
      inv.tax_minor,
      inv.total_minor,
      extra.paidMinor ?? 0,
      inv.issue_date,
      inv.due_date,
      inv.note ?? null,
      JSON.stringify(inv.items),
      extra.recipientViewUrl ?? null,
      extra.proposalId ?? null,
      extra.sentAt ?? null,
      extra.paidAt ?? null,
      ts,
      ts,
    );
  return getInvoiceRow(orgId, id)!;
}

export function getInvoiceRow(orgId: string, id: string): InvoiceRow | undefined {
  return getDb().prepare("SELECT * FROM invoices WHERE org_id = ? AND id = ?").get(orgId, id) as InvoiceRow | undefined;
}

export function getInvoiceByPaypalId(orgId: string, paypalId: string): InvoiceRow | undefined {
  return getDb().prepare("SELECT * FROM invoices WHERE org_id = ? AND paypal_invoice_id = ?").get(orgId, paypalId) as
    | InvoiceRow
    | undefined;
}

export function getInvoiceByProposal(orgId: string, proposalId: string): InvoiceRow | undefined {
  return getDb().prepare("SELECT * FROM invoices WHERE org_id = ? AND proposal_id = ?").get(orgId, proposalId) as
    | InvoiceRow
    | undefined;
}

/** Look up by our id, PayPal id, or invoice number. */
export function resolveInvoiceRef(orgId: string, ref: string): InvoiceRow | undefined {
  const r = ref.trim();
  return getDb()
    .prepare(
      "SELECT * FROM invoices WHERE org_id = ? AND (id = ? OR paypal_invoice_id = ? OR invoice_number = ?) ORDER BY created_at DESC LIMIT 1",
    )
    .get(orgId, r, r, r) as InvoiceRow | undefined;
}

export type InvoiceFilter = {
  status?: string;
  client?: string;
  source?: InvoiceSource | "all";
  includeDemo?: boolean;
  limit?: number;
};

export function listInvoices(orgId: string, f: InvoiceFilter = {}): InvoiceRow[] {
  const where = ["org_id = ?"];
  const args: unknown[] = [orgId];
  if (f.status) {
    where.push("status = ?");
    args.push(f.status);
  }
  if (f.client) {
    where.push("(lower(client_name) LIKE ? OR lower(client_email) LIKE ?)");
    args.push(`%${f.client.toLowerCase()}%`, `%${f.client.toLowerCase()}%`);
  }
  if (f.source && f.source !== "all") {
    where.push("source = ?");
    args.push(f.source);
  } else if (f.includeDemo === false) {
    where.push("source != 'demo'");
  }
  args.push(f.limit ?? 500);
  return getDb()
    .prepare(`SELECT * FROM invoices WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
    .all(...args) as InvoiceRow[];
}

export function updateInvoice(orgId: string, id: string, patch: Partial<InvoiceRow>) {
  const allowed = [
    "status",
    "paypal_invoice_id",
    "paypal_status",
    "invoice_number",
    "paid_minor",
    "total_minor",
    "recipient_view_url",
    "sent_at",
    "paid_at",
    "last_reminded_at",
    "last_synced_at",
  ] as const;
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const k of allowed) {
    if (k in patch) {
      sets.push(`${k} = ?`);
      args.push((patch as Record<string, unknown>)[k] ?? null);
    }
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  args.push(now(), orgId, id);
  getDb().prepare(`UPDATE invoices SET ${sets.join(", ")} WHERE org_id = ? AND id = ?`).run(...args);
}

export function deleteDemoData(orgId: string) {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM invoices WHERE org_id = ? AND source = 'demo'").run(orgId);
    db.prepare(
      "DELETE FROM clients WHERE org_id = ? AND source = 'demo' AND id NOT IN (SELECT client_id FROM invoices WHERE client_id IS NOT NULL)",
    ).run(orgId);
  })();
}

/* ---------------- Proposals ---------------- */

export type ProposalKind = "create_and_send_invoice" | "send_reminder";
export type ProposalStatus = "pending_approval" | "executing" | "executed" | "failed" | "cancelled";

export type ProposalRow = {
  id: string;
  org_id: string;
  conversation_id: string | null;
  kind: ProposalKind;
  status: ProposalStatus;
  payload_json: string;
  invoice_id: string | null;
  idempotency_key: string;
  attempts: number;
  result_json: string | null;
  error: string | null;
  created_by: string;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
};

export function insertProposal(
  orgId: string,
  p: { kind: ProposalKind; payload: unknown; conversationId?: string | null; invoiceId?: string | null; createdBy?: string },
): ProposalRow {
  const id = newId("prop");
  getDb()
    .prepare(
      `INSERT INTO proposals (id, org_id, conversation_id, kind, status, payload_json, invoice_id, idempotency_key, created_by, created_at)
       VALUES (?,?,?,?, 'pending_approval', ?,?,?,?,?)`,
    )
    .run(
      id,
      orgId,
      p.conversationId ?? null,
      p.kind,
      JSON.stringify(p.payload),
      p.invoiceId ?? null,
      `nexora-${id}`,
      p.createdBy ?? "ai",
      now(),
    );
  return getProposal(orgId, id)!;
}

export function getProposal(orgId: string, id: string): ProposalRow | undefined {
  return getDb().prepare("SELECT * FROM proposals WHERE org_id = ? AND id = ?").get(orgId, id) as ProposalRow | undefined;
}

export function listProposals(orgId: string, opts: { status?: ProposalStatus; conversationId?: string } = {}): ProposalRow[] {
  const where = ["org_id = ?"];
  const args: unknown[] = [orgId];
  if (opts.status) {
    where.push("status = ?");
    args.push(opts.status);
  }
  if (opts.conversationId) {
    where.push("conversation_id = ?");
    args.push(opts.conversationId);
  }
  return getDb()
    .prepare(`SELECT * FROM proposals WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 100`)
    .all(...args) as ProposalRow[];
}

/**
 * Atomic compare-and-set. Returns true only for the single caller that won the transition.
 * This is the database-level guard against double-submits.
 */
export function transitionProposal(
  orgId: string,
  id: string,
  from: ProposalStatus[],
  to: ProposalStatus,
  patch: { result?: unknown; error?: string | null; invoiceId?: string | null; incrementAttempts?: boolean } = {},
): boolean {
  const placeholders = from.map(() => "?").join(",");
  const ts = now();
  const res = getDb()
    .prepare(
      `UPDATE proposals SET status = ?,
         result_json = CASE WHEN ? IS NULL THEN result_json ELSE ? END,
         error = ?,
         invoice_id = coalesce(?, invoice_id),
         attempts = attempts + ?,
         decided_at = coalesce(decided_at, ?),
         executed_at = CASE WHEN ? = 'executed' THEN ? ELSE executed_at END
       WHERE org_id = ? AND id = ? AND status IN (${placeholders})`,
    )
    .run(
      to,
      patch.result === undefined ? null : 1,
      patch.result === undefined ? null : JSON.stringify(patch.result),
      patch.error ?? null,
      patch.invoiceId ?? null,
      patch.incrementAttempts ? 1 : 0,
      ts,
      to,
      ts,
      orgId,
      id,
      ...from,
    );
  return res.changes === 1;
}

export function updateProposalPayload(orgId: string, id: string, payload: unknown): boolean {
  const res = getDb()
    .prepare("UPDATE proposals SET payload_json = ? WHERE org_id = ? AND id = ? AND status = 'pending_approval'")
    .run(JSON.stringify(payload), orgId, id);
  return res.changes === 1;
}

/* ---------------- Conversations ---------------- */

export type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "tool";
  content_json: string;
  created_at: string;
};

export function ensureConversation(orgId: string, id?: string | null, title?: string): string {
  if (id) {
    const ok = getDb().prepare("SELECT id FROM conversations WHERE org_id = ? AND id = ?").get(orgId, id);
    if (ok) return id;
  }
  const cid = newId("conv");
  getDb()
    .prepare("INSERT INTO conversations (id, org_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run(cid, orgId, title?.slice(0, 80) ?? null, now(), now());
  return cid;
}

export function appendMessage(orgId: string, conversationId: string, role: MessageRow["role"], content: unknown) {
  getDb()
    .prepare("INSERT INTO messages (id, conversation_id, org_id, role, content_json, created_at) VALUES (?,?,?,?,?,?)")
    .run(newId("msg"), conversationId, orgId, role, JSON.stringify(content), now());
  getDb().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), conversationId);
}

export function listMessages(orgId: string, conversationId: string): MessageRow[] {
  return getDb()
    .prepare("SELECT * FROM messages WHERE org_id = ? AND conversation_id = ? ORDER BY created_at, rowid")
    .all(orgId, conversationId) as MessageRow[];
}

export function latestConversation(orgId: string): string | undefined {
  const r = getDb().prepare("SELECT id FROM conversations WHERE org_id = ? ORDER BY updated_at DESC LIMIT 1").get(orgId) as
    | { id: string }
    | undefined;
  return r?.id;
}
