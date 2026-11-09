"use client";

import clsx from "clsx";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { InvoiceDTO } from "@/lib/views";
import { api, fmtDate, fmtMoney, fmtRelative } from "@/lib/client";
import { Button, EmptyState, ErrorNote, PageHeader, SourceBadge, Spinner, StatusBadge } from "@/components/ui";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
] as const;
const OPEN = new Set(["sent", "overdue", "partially_paid", "payment_pending"]);
const POLL_MS = 20000;

export default function InvoicesPage() {
  const [rows, setRows] = useState<InvoiceDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [hideDemo, setHideDemo] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ invoices: InvoiceDTO[] }>("/api/invoices");
      setRows(r.invoices);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const sync = useCallback(
    async (manual = false) => {
      if (manual) setSyncing(true);
      try {
        await api("/api/invoices/sync", { method: "POST", body: {} });
        setLastSync(new Date().toISOString());
        setSyncError(null);
        await load();
      } catch (e) {
        setSyncError((e as Error).message);
      } finally {
        setSyncing(false);
      }
    },
    [load],
  );

  useEffect(() => {
    load().then(() => sync());
  }, [load, sync]);

  // Poll PayPal while there are open PayPal invoices and the tab is visible.
  const hasOpenPayPal = !!rows?.some((r) => r.source !== "demo" && OPEN.has(r.status));
  useEffect(() => {
    if (!hasOpenPayPal) return;
    timer.current = setInterval(() => {
      if (document.visibilityState === "visible") sync();
    }, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [hasOpenPayPal, sync]);

  const visible = (rows ?? []).filter((r) => {
    if (hideDemo && r.source === "demo") return false;
    if (filter === "open") return OPEN.has(r.status);
    if (filter === "overdue") return r.status === "overdue";
    if (filter === "paid") return r.status === "paid";
    return true;
  });

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every invoice NEXORA created through PayPal, plus any demo rows. Status is pulled from PayPal."
        actions={
          <>
            <span className="text-xs text-ink-3" aria-live="polite">
              {lastSync ? `Synced with PayPal ${fmtRelative(lastSync)}` : hasOpenPayPal ? "Syncing…" : ""}
            </span>
            <Button onClick={() => sync(true)} loading={syncing} icon={<RefreshCw className="size-4" aria-hidden />}>
              Refresh from PayPal
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Filter invoices" className="inline-flex rounded-[var(--radius-control)] border border-rule bg-sheet p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={clsx("h-8 rounded-md px-3 text-sm font-medium", filter === f.key ? "bg-ink text-white" : "text-ink-2 hover:bg-paper")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={hideDemo} onChange={(e) => setHideDemo(e.target.checked)} className="size-4 accent-[var(--stamp)]" />
          Hide demo data
        </label>
      </div>

      {syncError ? (
        <div className="mb-4">
          <ErrorNote message={`Couldn't sync with PayPal: ${syncError}`} onRetry={() => sync(true)} />
        </div>
      ) : null}
      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {!rows && !error ? <Spinner label="Loading invoices" /> : null}

      {rows && !rows.length ? (
        <EmptyState
          title="No invoices yet"
          body="Create your first one from the Command Center, or load demo data in Settings to explore the dashboard."
          action={
            <Link href="/app" className="text-sm font-semibold text-stamp hover:underline">
              Go to Command Center
            </Link>
          }
        />
      ) : null}

      {rows && rows.length > 0 && !visible.length ? <p className="text-sm text-ink-3">No invoices match this filter.</p> : null}

      {visible.length ? (
        <>
          <ul className="divide-y divide-rule overflow-hidden rounded-[var(--radius-panel)] border border-rule bg-sheet md:hidden">
            {visible.map((r) => (
              <li key={r.id}>
                <Link href={`/app/invoices/${r.id}`} className="block px-4 py-4 hover:bg-paper/60">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-medium">{r.client_name}</span>
                    <span className="num shrink-0 font-semibold">{fmtMoney(r.total_minor, r.currency)}</span>
                  </span>
                  <span className="num mt-0.5 block text-xs text-ink-3">
                    {r.invoice_number ?? r.paypal_invoice_id ?? "—"} · due {fmtDate(r.due_date)}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge status={r.status} />
                    <SourceBadge source={r.source} paypalId={r.paypal_invoice_id} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-[var(--radius-panel)] border border-rule bg-sheet md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Invoices</caption>
              <thead className="border-b border-rule bg-paper/60 text-left text-xs text-ink-3">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Client</th>
                  <th scope="col" className="px-3 py-3 font-medium">Invoice</th>
                  <th scope="col" className="px-3 py-3 font-medium">Source</th>
                  <th scope="col" className="px-3 py-3 font-medium">Due</th>
                  <th scope="col" className="px-3 py-3 font-medium">Status</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="relative border-b border-rule/70 last:border-0 hover:bg-paper/60">
                    <td className="px-5 py-3.5">
                      <Link href={`/app/invoices/${r.id}`} className="font-medium text-ink after:absolute after:inset-0 hover:underline">
                        {r.client_name}
                      </Link>
                      <span className="block text-xs text-ink-3">{r.client_email}</span>
                    </td>
                    <td className="num px-3 py-3.5 text-ink-2">{r.invoice_number ?? r.paypal_invoice_id ?? "—"}</td>
                    <td className="px-3 py-3.5">
                      <SourceBadge source={r.source} paypalId={r.paypal_invoice_id} />
                    </td>
                    <td className="num px-3 py-3.5 text-ink-2">{fmtDate(r.due_date)}</td>
                    <td className="px-3 py-3.5">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="num px-5 py-3.5 text-right font-semibold">
                      {fmtMoney(r.total_minor, r.currency)}
                      {r.status === "partially_paid" ? <span className="block text-xs font-normal text-ink-3">{fmtMoney(r.outstanding_minor, r.currency)} left</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
