import "server-only";
import { listInvoices, type InvoiceRow } from "@/lib/db/repo";
import { daysBetween } from "@/lib/invoices/schema";
import { effectiveStatus, todayISO } from "@/lib/invoices/service";

export type Facts = {
  generated_at: string;
  scope: { include_demo: boolean; invoice_count: number; demo_count: number; paypal_count: number; currencies: string[] };
  primary_currency: string;
  totals: {
    billed_minor: number;
    collected_minor: number;
    outstanding_minor: number;
    overdue_minor: number;
    overdue_count: number;
    open_count: number;
    paid_count: number;
  };
  avg_days_to_pay: number | null;
  collection_rate_pct: number | null;
  aging: { bucket: string; minor: number; count: number }[];
  by_status: { status: string; count: number; minor: number }[];
  monthly: { month: string; billed_minor: number; collected_minor: number }[];
  top_clients_outstanding: { client: string; minor: number; count: number; oldest_due: string }[];
  /** Labeled Estimate everywhere it is shown. */
  estimate_next_30d_collections_minor: number;
  note: string;
};

const OPEN = new Set(["sent", "overdue", "partially_paid", "payment_pending"]);

/**
 * Deterministic, auditable facts computed from the database.
 * Amounts are aggregated in the primary currency only; other currencies are counted but excluded from sums.
 */
export function computeFacts(orgId: string, opts: { includeDemo: boolean }): Facts {
  const today = todayISO();
  const rows = listInvoices(orgId, { includeDemo: opts.includeDemo, limit: 5000 }).map((r) => ({
    ...r,
    status: effectiveStatus(r, today),
  }));
  const currencyCounts = new Map<string, number>();
  rows.forEach((r) => currencyCounts.set(r.currency, (currencyCounts.get(r.currency) ?? 0) + 1));
  const primary = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const inCur = rows.filter((r) => r.currency === primary && r.status !== "draft" && r.status !== "cancelled");

  const open = inCur.filter((r) => OPEN.has(r.status));
  const outstanding = (r: InvoiceRow) => Math.max(0, r.total_minor - r.paid_minor);

  const paidRows = inCur.filter((r) => r.status === "paid" && r.paid_at && r.sent_at);
  const dtp = paidRows.map((r) => daysBetween(r.sent_at!.slice(0, 10), r.paid_at!.slice(0, 10))).filter((d) => d >= 0);

  const billed = inCur.reduce((a, r) => a + r.total_minor, 0);
  const collected = inCur.reduce((a, r) => a + r.paid_minor, 0);

  const buckets = [
    { bucket: "Not due", test: (d: number) => d <= 0 },
    { bucket: "1–30 days late", test: (d: number) => d >= 1 && d <= 30 },
    { bucket: "31–60 days late", test: (d: number) => d >= 31 && d <= 60 },
    { bucket: "60+ days late", test: (d: number) => d > 60 },
  ];
  const aging = buckets.map((b) => {
    const m = open.filter((r) => b.test(daysBetween(r.due_date, today)));
    return { bucket: b.bucket, minor: m.reduce((a, r) => a + outstanding(r), 0), count: m.length };
  });

  const statusMap = new Map<string, { count: number; minor: number }>();
  rows.filter((r) => r.currency === primary).forEach((r) => {
    const s = statusMap.get(r.status) ?? { count: 0, minor: 0 };
    s.count += 1;
    s.minor += r.total_minor;
    statusMap.set(r.status, s);
  });

  const months: string[] = [];
  const d = new Date(today + "T00:00:00Z");
  for (let i = 5; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    months.push(m.toISOString().slice(0, 7));
  }
  const monthly = months.map((month) => ({
    month,
    billed_minor: inCur.filter((r) => r.issue_date.startsWith(month)).reduce((a, r) => a + r.total_minor, 0),
    collected_minor: inCur.filter((r) => r.paid_at?.startsWith(month)).reduce((a, r) => a + r.paid_minor, 0),
  }));

  const clients = new Map<string, { minor: number; count: number; oldest_due: string }>();
  open.forEach((r) => {
    const c = clients.get(r.client_name) ?? { minor: 0, count: 0, oldest_due: r.due_date };
    c.minor += outstanding(r);
    c.count += 1;
    if (r.due_date < c.oldest_due) c.oldest_due = r.due_date;
    clients.set(r.client_name, c);
  });

  // Estimate: open invoices due within 30 days (or already late ≤30d) × historical collection rate.
  const rate = billed > 0 ? collected / billed : 0;
  const dueSoon = open.filter((r) => {
    const late = daysBetween(r.due_date, today);
    return late <= 30 && daysBetween(today, r.due_date) <= 30;
  });
  const estimate = Math.round(dueSoon.reduce((a, r) => a + outstanding(r), 0) * rate);

  return {
    generated_at: new Date().toISOString(),
    scope: {
      include_demo: opts.includeDemo,
      invoice_count: rows.length,
      demo_count: rows.filter((r) => r.source === "demo").length,
      paypal_count: rows.filter((r) => r.source === "paypal_sandbox").length,
      currencies: [...currencyCounts.keys()],
    },
    primary_currency: primary,
    totals: {
      billed_minor: billed,
      collected_minor: collected,
      outstanding_minor: open.reduce((a, r) => a + outstanding(r), 0),
      overdue_minor: open.filter((r) => r.status === "overdue").reduce((a, r) => a + outstanding(r), 0),
      overdue_count: open.filter((r) => r.status === "overdue").length,
      open_count: open.length,
      paid_count: inCur.filter((r) => r.status === "paid").length,
    },
    avg_days_to_pay: dtp.length ? Math.round((dtp.reduce((a, b) => a + b, 0) / dtp.length) * 10) / 10 : null,
    collection_rate_pct: billed > 0 ? Math.round((collected / billed) * 1000) / 10 : null,
    aging,
    by_status: [...statusMap.entries()].map(([status, v]) => ({ status, ...v })),
    monthly,
    top_clients_outstanding: [...clients.entries()]
      .map(([client, v]) => ({ client, ...v }))
      .sort((a, b) => b.minor - a.minor)
      .slice(0, 5),
    estimate_next_30d_collections_minor: estimate,
    note: "Amounts are integer minor units of primary_currency. Invoices in other currencies are counted in scope but excluded from sums.",
  };
}
