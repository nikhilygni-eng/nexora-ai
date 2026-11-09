"use client";

import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Sparkles, TrendingUp, TriangleAlert, Lightbulb } from "lucide-react";
import type { Facts } from "@/lib/analytics";
import type { InvoiceDTO } from "@/lib/views";
import { api, fmtMoney } from "@/lib/client";
import { InvoiceGrid } from "@/components/invoice-grid";
import { Button, EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";

const C_BILLED = "#2442c9";
const C_COLLECTED = "#1f9e8f";

type Insight = { kind: "risk" | "opportunity" | "trend"; title: string; detail: string; grounded: { key: string; value: string }[] };

export default function AnalyticsPage() {
  const [includeDemo, setIncludeDemo] = useState(true);
  const [data, setData] = useState<{ facts: Facts; invoices: InvoiceDTO[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<{ items: Insight[]; dropped: number; model: string } | null>(null);
  const [insErr, setInsErr] = useState<string | null>(null);
  const [insLoading, setInsLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api(`/api/analytics?includeDemo=${includeDemo}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [includeDemo]);

  useEffect(() => {
    load();
    setInsights(null);
  }, [load]);

  async function explain() {
    setInsLoading(true);
    setInsErr(null);
    try {
      const r = await api<{ insights: Insight[]; dropped: number; model: string }>("/api/insights", { body: { includeDemo } });
      setInsights({ items: r.insights, dropped: r.dropped, model: r.model });
    } catch (e) {
      setInsErr((e as Error).message);
    } finally {
      setInsLoading(false);
    }
  }

  const f = data?.facts;
  const cur = f?.primary_currency ?? "USD";
  const m = (v: number) => fmtMoney(v, cur);
  const div = ["JPY", "HUF", "TWD"].includes(cur) ? 1 : 100;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Receivables computed from your invoices. AI insights cite only these numbers."
        actions={
          <label className="inline-flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} className="size-4 accent-[var(--stamp)]" />
            Include demo data
          </label>
        }
      />
      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {!data && !error ? <Spinner label="Crunching numbers" /> : null}

      {f && f.scope.invoice_count === 0 ? (
        <EmptyState title="Nothing to analyze yet" body="Send an invoice from the Command Center, or load demo data from Settings to see the dashboard." />
      ) : null}

      {f && f.scope.invoice_count > 0 ? (
        <div className="space-y-8">
          {f.scope.demo_count > 0 ? (
            <p className="text-sm text-ink-3">
              Includes {f.scope.demo_count} demo invoice{f.scope.demo_count > 1 ? "s" : ""} and {f.scope.paypal_count} from PayPal Sandbox. Totals are in {cur}
              {f.scope.currencies.length > 1 ? `; other currencies (${f.scope.currencies.filter((c) => c !== cur).join(", ")}) are counted but not summed` : ""}.
            </p>
          ) : null}

          {/* Headline figure + supporting tiles */}
          <section aria-label="Key figures" className="grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="bg-ink p-6 text-white">
              <p className="text-sm text-white/75">Outstanding</p>
              <p className="num mt-1 font-display text-[2.75rem] font-semibold leading-none tracking-[-0.03em]">{m(f.totals.outstanding_minor)}</p>
              <p className="mt-3 text-sm text-white/75">
                across {f.totals.open_count} open invoice{f.totals.open_count === 1 ? "" : "s"}
              </p>
            </div>
            <Tile label="Overdue" value={m(f.totals.overdue_minor)} sub={`${f.totals.overdue_count} invoice${f.totals.overdue_count === 1 ? "" : "s"} past due`} alert={f.totals.overdue_count > 0} />
            <Tile label="Collected" value={m(f.totals.collected_minor)} sub={f.collection_rate_pct === null ? "—" : `${f.collection_rate_pct}% of billed`} />
            <Tile label="Avg. days to pay" value={f.avg_days_to_pay === null ? "—" : String(f.avg_days_to_pay)} sub={`Estimate next 30 days: ${m(f.estimate_next_30d_collections_minor)}`} />
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            <ChartPanel title="Billed vs collected" subtitle={`Last 6 months, ${cur}`}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={f.monthly.map((x) => ({ month: monthLabel(x.month), Billed: x.billed_minor / div, Collected: x.collected_minor / div }))} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e6ebf1" />
                  <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "#d8dfe8" }} tick={{ fill: "#5b6f86", fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: "#5b6f86", fontSize: 12 }} tickFormatter={compact} />
                  <Tooltip cursor={{ fill: "rgba(15,42,68,0.05)" }} formatter={(v) => m(Math.round(Number(v) * div))} contentStyle={{ borderRadius: 8, borderColor: "#d8dfe8", fontSize: 13 }} />
                  <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: "#344b66" }} />
                  <Bar dataKey="Billed" fill={C_BILLED} maxBarSize={22} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Collected" fill={C_COLLECTED} maxBarSize={22} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <ChartTable
                caption="Billed vs collected by month"
                head={["Month", "Billed", "Collected"]}
                rows={f.monthly.map((x) => [monthLabel(x.month), m(x.billed_minor), m(x.collected_minor)])}
              />
            </ChartPanel>

            <ChartPanel title="Aging of open invoices" subtitle={`Outstanding by days past due, ${cur}`}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart layout="vertical" data={f.aging.map((a) => ({ bucket: a.bucket, Amount: a.minor / div, count: a.count }))} margin={{ top: 8, right: 56, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke="#e6ebf1" />
                  <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: "#5b6f86", fontSize: 12 }} tickFormatter={compact} />
                  <YAxis type="category" dataKey="bucket" tickLine={false} axisLine={false} width={124} tick={{ fill: "#344b66", fontSize: 12 }} />
                  <Tooltip cursor={{ fill: "rgba(15,42,68,0.05)" }} formatter={(v, _n, p) => [`${m(Math.round(Number(v) * div))} · ${(p.payload as { count: number }).count} invoice(s)`, "Outstanding"]} contentStyle={{ borderRadius: 8, borderColor: "#d8dfe8", fontSize: 13 }} />
                  <Bar dataKey="Amount" fill={C_BILLED} maxBarSize={22} radius={[0, 4, 4, 0]} label={{ position: "right", fill: "#344b66", fontSize: 12, formatter: (v: unknown) => (Number(v) ? compact(Number(v)) : "") }} />
                </BarChart>
              </ResponsiveContainer>
              <ChartTable caption="Aging buckets" head={["Bucket", "Outstanding", "Invoices"]} rows={f.aging.map((a) => [a.bucket, m(a.minor), String(a.count)])} />
            </ChartPanel>
          </div>

          <section aria-labelledby="ins-title" className="rounded-[var(--radius-panel)] border border-rule bg-sheet p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="ins-title" className="font-display text-xl font-semibold tracking-tight">AI insights</h2>
                <p className="text-sm text-ink-3">Written by the model from the figures above. Each insight lists the numbers it used.</p>
              </div>
              <Button variant="primary" onClick={explain} loading={insLoading} icon={<Sparkles className="size-4" aria-hidden />}>
                {insights ? "Regenerate" : "Explain my receivables"}
              </Button>
            </div>
            {insErr ? (
              <div className="mt-4">
                <ErrorNote message={insErr} onRetry={explain} />
              </div>
            ) : null}
            {insights ? (
              insights.items.length ? (
                <ul className="mt-5 grid gap-4 md:grid-cols-2">
                  {insights.items.map((ins, i) => (
                    <li key={i} className="rounded-[var(--radius-control)] border border-rule p-4">
                      <p className="flex items-center gap-2 text-xs font-semibold text-ink-2">
                        <KindIcon kind={ins.kind} />
                        {ins.kind === "risk" ? "Risk" : ins.kind === "opportunity" ? "Opportunity" : "Trend"}
                      </p>
                      <p className="mt-2 font-semibold">{ins.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-2">{ins.detail}</p>
                      <details className="mt-3 text-xs text-ink-3">
                        <summary className="cursor-pointer">Based on {ins.grounded.length} figure{ins.grounded.length > 1 ? "s" : ""}</summary>
                        <ul className="mt-2 space-y-1">
                          {ins.grounded.map((g) => (
                            <li key={g.key} className="num">
                              {g.value}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-ink-3">The model didn&apos;t return any insight that could be verified against your data. Try regenerating.</p>
              )
            ) : null}
            {insights ? (
              <p className="mt-4 text-xs text-ink-3">
                Model: {insights.model}
                {insights.dropped ? ` · ${insights.dropped} insight(s) discarded for citing numbers not in your data` : ""}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="grid-title" className="space-y-3">
            <h2 id="grid-title" className="font-display text-xl font-semibold tracking-tight">All invoices</h2>
            <InvoiceGrid invoices={data!.invoices} />
          </section>
        </div>
      ) : null}
    </>
  );
}

function Tile({ label, value, sub, alert }: { label: string; value: string; sub: string; alert?: boolean }) {
  return (
    <div className="bg-sheet p-6">
      <p className="flex items-center gap-1.5 text-sm text-ink-2">
        {alert ? <TriangleAlert className="size-4 text-rose-ink" aria-label="Needs attention" /> : null}
        {label}
      </p>
      <p className={clsx("num mt-1 font-display text-3xl font-semibold tracking-tight", alert && "text-rose-ink")}>{value}</p>
      <p className="mt-2 text-xs text-ink-3">{sub}</p>
    </div>
  );
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-rule bg-sheet p-5 sm:p-6" aria-label={title}>
      <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mb-4 text-xs text-ink-3">{subtitle}</p>
      {children}
    </section>
  );
}

function ChartTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <details className="mt-3 text-xs text-ink-3">
      <summary className="cursor-pointer">View as table</summary>
      <table className="num mt-2 w-full text-left text-sm text-ink">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-rule text-xs text-ink-3">
            {head.map((h) => (
              <th key={h} scope="col" className="py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-b border-rule/60">
              {r.map((c, i) => (
                <td key={i} className="py-1.5">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function KindIcon({ kind }: { kind: Insight["kind"] }) {
  if (kind === "risk") return <TriangleAlert className="size-4 text-rose-ink" aria-hidden />;
  if (kind === "opportunity") return <Lightbulb className="size-4 text-canary-ink" aria-hidden />;
  return <TrendingUp className="size-4 text-stamp" aria-hidden />;
}

function compact(v: number) {
  return Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}K` : String(Math.round(v));
}

function monthLabel(ym: string) {
  return new Date(ym + "-01T00:00:00Z").toLocaleString("en-US", { month: "short", timeZone: "UTC" });
}
