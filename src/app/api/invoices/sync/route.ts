import { apiError, json, requireSession } from "@/lib/api";
import { syncOpenInvoices } from "@/lib/invoices/service";

export const dynamic = "force-dynamic";

/** Polled by the UI: pulls fresh status for open PayPal invoices (throttled per invoice). */
export async function POST() {
  try {
    const { orgId } = await requireSession();
    const results = await syncOpenInvoices(orgId);
    return json({ results, changed: results.filter((r) => r.changed).length });
  } catch (e) {
    return apiError(e);
  }
}
