import "server-only";
import { insertInvoice, listInvoices, upsertClient } from "@/lib/db/repo";
import { logAudit } from "@/lib/audit";
import { invoiceTotals, lineTotals, type CurrencyCode } from "@/lib/money";
import { addDays } from "./schema";
import { todayISO } from "./service";

/**
 * Demo data for the dashboard. Every row is source='demo', uses reserved example.* domains,
 * and is labeled "Demo data" in the UI. It is never sent to PayPal.
 */
const CLIENTS = [
  { name: "Halden & Roe", company: "Halden & Roe GmbH", email: "ap@halden-roe.example", country: "DE" },
  { name: "Northwind Labs", company: "Northwind Labs Inc.", email: "billing@northwind.example", country: "US" },
  { name: "Kumo Studio", company: "Kumo Studio KK", email: "finance@kumo.example", country: "JP" },
  { name: "Margo Ferreira", company: null, email: "margo@ferreira.example", country: "PT" },
  { name: "Lumen Health", company: "Lumen Health Ltd", email: "accounts@lumen.example", country: "GB" },
];

type Seed = { c: number; item: string; amount: number; issuedDaysAgo: number; terms: number; paidAfter?: number; partial?: number };

const SEEDS: Seed[] = [
  { c: 0, item: "Brand system refresh", amount: 420000, issuedDaysAgo: 168, terms: 30, paidAfter: 26 },
  { c: 1, item: "Onboarding flow redesign", amount: 280000, issuedDaysAgo: 150, terms: 14, paidAfter: 12 },
  { c: 2, item: "Illustration set (12)", amount: 96000, issuedDaysAgo: 141, terms: 30, paidAfter: 44 },
  { c: 3, item: "Portfolio site build", amount: 150000, issuedDaysAgo: 120, terms: 14, paidAfter: 9 },
  { c: 4, item: "Patient app UX audit", amount: 320000, issuedDaysAgo: 112, terms: 30, paidAfter: 31 },
  { c: 1, item: "Design system retainer — Q3", amount: 450000, issuedDaysAgo: 95, terms: 30, paidAfter: 28 },
  { c: 0, item: "Packaging mockups", amount: 125000, issuedDaysAgo: 80, terms: 14, paidAfter: 20 },
  { c: 2, item: "Motion guidelines", amount: 180000, issuedDaysAgo: 72, terms: 30, partial: 90000 },
  { c: 4, item: "Clinician dashboard concepts", amount: 260000, issuedDaysAgo: 64, terms: 30 },
  { c: 3, item: "Copy edits + SEO pass", amount: 45000, issuedDaysAgo: 50, terms: 14, paidAfter: 6 },
  { c: 1, item: "Design system retainer — Q4", amount: 450000, issuedDaysAgo: 34, terms: 30, paidAfter: 18 },
  { c: 0, item: "Trade-fair microsite", amount: 310000, issuedDaysAgo: 41, terms: 30 },
  { c: 2, item: "App store screenshots", amount: 72000, issuedDaysAgo: 20, terms: 14 },
  { c: 4, item: "Accessibility remediation", amount: 190000, issuedDaysAgo: 12, terms: 30 },
  { c: 3, item: "Newsletter templates", amount: 60000, issuedDaysAgo: 6, terms: 14 },
];

export function seedDemoData(orgId: string): { created: number; skipped: boolean } {
  if (listInvoices(orgId, { source: "demo", limit: 1 }).length) return { created: 0, skipped: true };
  const today = todayISO();
  const clients = CLIENTS.map((c) => upsertClient(orgId, { ...c, source: "demo" }));
  let n = 0;
  for (const s of SEEDS) {
    const c = CLIENTS[s.c];
    const currency: CurrencyCode = "USD";
    const issue = addDays(today, -s.issuedDaysAgo);
    const due = addDays(issue, s.terms);
    const line = lineTotals({ unitMinor: s.amount, qtyHundredths: 100, taxMilli: 0 });
    const totals = invoiceTotals([{ unitMinor: s.amount, qtyHundredths: 100, taxMilli: 0 }]);
    const paidAt = s.paidAfter !== undefined ? addDays(issue, s.paidAfter) : null;
    const status = paidAt ? "paid" : s.partial ? "partially_paid" : "sent";
    n++;
    insertInvoice(
      orgId,
      {
        client_name: c.name,
        client_email: c.email,
        client_company: c.company ?? undefined,
        currency,
        tax_name: "Tax",
        tax_milli: 0,
        items: [{ name: s.item, quantity: "1", qty_hundredths: 100, unit_minor: s.amount, tax_milli: 0, subtotal_minor: line.subtotalMinor, tax_minor: 0 }],
        issue_date: issue,
        due_date: due,
        subtotal_minor: totals.subtotalMinor,
        tax_minor: totals.taxMinor,
        total_minor: totals.totalMinor,
      },
      {
        source: "demo",
        status,
        clientId: clients[s.c].id,
        invoiceNumber: `DEMO-${String(n).padStart(3, "0")}`,
        paidMinor: paidAt ? totals.totalMinor : s.partial ?? 0,
        sentAt: issue + "T09:00:00.000Z",
        paidAt: paidAt ? paidAt + "T15:00:00.000Z" : null,
        createdAt: issue + "T09:00:00.000Z",
      },
    );
  }
  logAudit({ orgId, actor: "user", action: "demo.seeded", details: { invoices: n } });
  return { created: n, skipped: false };
}
