import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { DEFAULT_ORG_ID, getDb } from "@/lib/db";
import { getInvoiceByPaypalId } from "@/lib/db/repo";
import { getEnv } from "@/lib/env";
import { syncInvoice } from "@/lib/invoices/service";
import { getPayPal } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/**
 * PayPal webhooks (INVOICING.INVOICE.PAID etc.). Signature is verified with PayPal's
 * verify-webhook-signature API before anything happens; then we re-fetch the invoice
 * from PayPal (never trusting the payload body for state).
 */
export async function POST(req: NextRequest) {
  const env = getEnv();
  if (!env.PAYPAL_WEBHOOK_ID) return NextResponse.json({ error: "Webhooks not configured" }, { status: 404 });
  const raw = await req.text();
  let event: { id?: string; event_type?: string; resource?: { id?: string; invoice?: { id?: string } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const h = (k: string) => req.headers.get(k);
  let verified = false;
  try {
    verified = await getPayPal().client.verifyWebhookSignature({
      webhookId: env.PAYPAL_WEBHOOK_ID,
      event,
      headers: {
        "paypal-auth-algo": h("paypal-auth-algo"),
        "paypal-cert-url": h("paypal-cert-url"),
        "paypal-transmission-id": h("paypal-transmission-id"),
        "paypal-transmission-sig": h("paypal-transmission-sig"),
        "paypal-transmission-time": h("paypal-transmission-time"),
      },
    });
  } catch {
    verified = false;
  }
  const resourceId = event.resource?.invoice?.id ?? event.resource?.id ?? null;
  if (event.id) {
    const dup = getDb()
      .prepare("INSERT OR IGNORE INTO webhook_events (id, org_id, event_type, resource_id, verified, received_at) VALUES (?,?,?,?,?,?)")
      .run(event.id, DEFAULT_ORG_ID, event.event_type ?? "unknown", resourceId, verified ? 1 : 0, new Date().toISOString());
    if (dup.changes === 0) return NextResponse.json({ ok: true, duplicate: true });
  }
  logAudit({ orgId: DEFAULT_ORG_ID, actor: "paypal", action: verified ? "webhook.received" : "webhook.rejected", paypalInvoiceId: resourceId ?? undefined, details: { event_type: event.event_type } });
  if (!verified) return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });

  if (resourceId && event.event_type?.startsWith("INVOICING.")) {
    const row = getInvoiceByPaypalId(DEFAULT_ORG_ID, resourceId);
    if (row) await syncInvoice(DEFAULT_ORG_ID, row.id).catch(() => undefined);
  }
  return NextResponse.json({ ok: true });
}
