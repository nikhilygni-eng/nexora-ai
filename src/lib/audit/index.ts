import "server-only";
import { getDb } from "@/lib/db";

export type AuditActor = "user" | "ai" | "system" | "paypal";

export type AuditEntry = {
  orgId: string;
  actor: AuditActor;
  action: string;
  entityType?: string;
  entityId?: string;
  paypalEndpoint?: string;
  httpStatus?: number;
  debugId?: string;
  paypalInvoiceId?: string;
  details?: Record<string, unknown>;
};

const SECRET_KEY_RE = /(token|secret|authorization|password|passcode|api[_-]?key|client_id)/i;

/** Deep-redact anything that looks like a credential before it touches the log. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    if (/^Bearer\s+/i.test(value) || /^Basic\s+/i.test(value)) return "[redacted]";
    return value.length > 2000 ? value.slice(0, 2000) + "…" : value;
  }
  return value;
}

export function logAudit(e: AuditEntry): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_log (org_id, at, actor, action, entity_type, entity_id, paypal_endpoint, http_status, debug_id, paypal_invoice_id, details_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        e.orgId,
        new Date().toISOString(),
        e.actor,
        e.action,
        e.entityType ?? null,
        e.entityId ?? null,
        e.paypalEndpoint ?? null,
        e.httpStatus ?? null,
        e.debugId ?? null,
        e.paypalInvoiceId ?? null,
        e.details ? JSON.stringify(redact(e.details)) : null,
      );
  } catch (err) {
    // Audit failures must never break the user flow, but they must be visible in server logs.
    console.error("[audit] failed to write entry", e.action, err);
  }
}

export type AuditRow = {
  id: number;
  at: string;
  actor: AuditActor;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  paypal_endpoint: string | null;
  http_status: number | null;
  debug_id: string | null;
  paypal_invoice_id: string | null;
  details_json: string | null;
};

export function listAudit(orgId: string, limit = 200): AuditRow[] {
  return getDb()
    .prepare("SELECT * FROM audit_log WHERE org_id = ? ORDER BY id DESC LIMIT ?")
    .all(orgId, limit) as AuditRow[];
}
