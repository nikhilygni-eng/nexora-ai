import { DEFAULT_ORG_ID } from "@/lib/db";
import { seedDemoData } from "@/lib/invoices/demo";

/**
 * Free hosting tiers wipe the local SQLite file on restart. With DEMO_AUTOSEED=true the labeled
 * demo invoices ("Demo data", never sent to PayPal) come back automatically, so the dashboard is
 * never empty for a visitor. Failure here never stops the server.
 */
export function autoseedDemo() {
  try {
    const r = seedDemoData(DEFAULT_ORG_ID);
    if (!r.skipped) console.info(`[nexora] DEMO_AUTOSEED: added ${r.created} labeled demo invoices`);
  } catch (e) {
    console.warn("[nexora] DEMO_AUTOSEED failed (the app still runs):", (e as Error).message);
  }
}
