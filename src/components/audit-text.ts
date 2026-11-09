import type { AuditRow } from "@/lib/audit";

const LABELS: Record<string, string> = {
  "proposal.created": "AI drafted a proposal",
  "proposal.edited": "You edited the draft",
  "proposal.approved": "You approved",
  "proposal.cancelled": "You cancelled the proposal",
  "proposal.executed": "Approved action completed",
  "proposal.failed": "Approved action failed",
  "paypal.invoice.created": "PayPal created the draft invoice",
  "paypal.invoice.sent": "PayPal sent the invoice",
  "paypal.invoice.reminded": "PayPal sent a reminder",
  "paypal.invoice.synced": "Status checked with PayPal",
  "paypal.invoice.status_changed": "PayPal status changed",
  "paypal.invoice.create_failed": "PayPal rejected the invoice",
  "paypal.invoice.send_failed": "PayPal couldn't send the invoice",
  "paypal.invoice.remind_failed": "PayPal couldn't send the reminder",
  "paypal.invoice.sync_failed": "Couldn't reach PayPal for status",
  "agent.turn": "AI assistant responded",
  "insights.generated": "AI generated insights",
  "settings.updated": "Settings updated",
  "demo.seeded": "Demo data loaded",
  "demo.cleared": "Demo data cleared",
  "auth.signed_in": "Signed in",
  "auth.failed": "Failed sign-in attempt",
  "webhook.received": "Verified PayPal webhook received",
  "webhook.rejected": "Unverified webhook rejected",
};

export function describeAudit(a: AuditRow): string {
  const base = LABELS[a.action] ?? a.action;
  if (a.action === "paypal.invoice.status_changed" && a.details_json) {
    try {
      const d = JSON.parse(a.details_json) as { from?: string; to?: string };
      return `${base}: ${d.from} → ${d.to}`;
    } catch {
      /* ignore */
    }
  }
  return base;
}
