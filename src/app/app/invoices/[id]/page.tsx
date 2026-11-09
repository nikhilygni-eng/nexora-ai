"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { ArrowLeft, BellRing, ExternalLink, RefreshCw } from "lucide-react";
import type { InvoiceDTO, ProposalDTO } from "@/lib/views";
import type { AuditRow } from "@/lib/audit";
import { api, fmtDate, fmtMoney, fmtRelative } from "@/lib/client";
import { ProposalCard } from "@/components/invoice-slip";
import { Button, ErrorNote, SourceBadge, Spinner, StatusBadge } from "@/components/ui";
import { describeAudit } from "@/components/audit-text";

type Detail = { invoice: InvoiceDTO; activity: AuditRow[]; reminders: ProposalDTO[] };

export default function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "sync" | "remind" | "pay">(null);
  const [actionError, setActionError] = useState<{ message: string; debugId?: string } | null>(null);
  const [mode, setMode] = useState<string>("sandbox");

  const load = useCallback(async () => {
    try {
      setD(await api<Detail>(`/api/invoices/${id}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
    api<{ paypalMode: string }>("/api/setup").then((s) => setMode(s.paypalMode)).catch(() => undefined);
  }, [load]);

  async function act(kind: "sync" | "remind" | "pay") {
    setBusy(kind);
    setActionError(null);
    try {
      if (kind === "sync") await api(`/api/invoices/${id}/sync`, { method: "POST", body: {} });
      if (kind === "remind") await api(`/api/invoices/${id}/reminder`, { method: "POST", body: { tone: "friendly" } });
      if (kind === "pay") {
        await api(`/api/mock/pay`, { method: "POST", body: { paypalInvoiceId: d?.invoice.paypal_invoice_id } });
        await api(`/api/invoices/${id}/sync`, { method: "POST", body: {} });
      }
      await load();
    } catch (e) {
      setActionError({ message: (e as Error).message, debugId: (e as { debugId?: string }).debugId });
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorNote message={error} onRetry={load} />;
  if (!d) return <Spinner label="Loading invoice" />;
  const inv = d.invoice;
  const isPayPal = inv.source !== "demo";
  const pendingReminder = d.reminders.find((r) => r.status === "pending_approval" || r.status === "failed");

  return (
    <div className="space-y-8">
      <Link href="/app/invoices" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Invoices
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={inv.source} paypalId={inv.paypal_invoice_id} />
            <StatusBadge status={inv.status} />
          </div>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-[-0.02em] sm:text-[2.5rem] sm:leading-[1.05]">{inv.client_name}</h1>
          <p className="mt-1 text-sm text-ink-2">{inv.client_email}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-ink-3">{inv.status === "paid" ? "Paid" : "Outstanding"}</p>
          <p className="num font-display text-4xl font-semibold tracking-tight">{fmtMoney(inv.status === "paid" ? inv.paid_minor : inv.outstanding_minor, inv.currency)}</p>
          <p className="num text-sm text-ink-3">of {fmtMoney(inv.total_minor, inv.currency)} · due {fmtDate(inv.due_date)}</p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {isPayPal ? (
          <Button onClick={() => act("sync")} loading={busy === "sync"} disabled={!!busy} icon={<RefreshCw className="size-4" aria-hidden />}>
            Refresh status from PayPal
          </Button>
        ) : null}
        {inv.can_remind && !pendingReminder ? (
          <Button variant="primary" onClick={() => act("remind")} loading={busy === "remind"} disabled={!!busy} icon={<BellRing className="size-4" aria-hidden />}>
            Draft reminder with AI
          </Button>
        ) : null}
        {inv.recipient_view_url && inv.source === "paypal_sandbox" ? (
          <a href={inv.recipient_view_url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-4 text-sm font-medium text-stamp hover:bg-stamp-tint">
            Open payer view in PayPal Sandbox <ExternalLink className="size-4" aria-hidden />
          </a>
        ) : null}
        {mode === "mock" && inv.source === "mock_paypal" && inv.status !== "paid" ? (
          <Button variant="ghost" onClick={() => act("pay")} loading={busy === "pay"} disabled={!!busy}>
            Simulate payment (mock only)
          </Button>
        ) : null}
      </div>
      {actionError ? <ErrorNote message={actionError.message} debugId={actionError.debugId} /> : null}
      {inv.source === "demo" ? <p className="text-sm text-ink-3">This is seeded demo data. It isn&apos;t in PayPal, so it can&apos;t be synced or reminded.</p> : null}

      {d.reminders.length ? (
        <section aria-labelledby="rem-title" className="space-y-3">
          <h2 id="rem-title" className="font-display text-xl font-semibold tracking-tight">Reminders</h2>
          {d.reminders.map((r) => (
            <ProposalCard key={r.id} proposal={r} onChange={() => load()} />
          ))}
        </section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="items-title" className="rounded-[var(--radius-panel)] border border-rule bg-sheet p-5 sm:p-6">
          <h2 id="items-title" className="font-display text-xl font-semibold tracking-tight">Details</h2>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-ink-3">PayPal invoice ID</dt>
              <dd className="num mt-0.5 break-all font-medium">{inv.paypal_invoice_id ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Number</dt>
              <dd className="num mt-0.5 font-medium">{inv.invoice_number ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-3">PayPal status</dt>
              <dd className="mt-0.5 font-medium">{inv.paypal_status ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Last synced</dt>
              <dd className="mt-0.5 font-medium">{inv.last_synced_at ? fmtRelative(inv.last_synced_at) : "—"}</dd>
            </div>
          </dl>
          <table className="mt-6 w-full text-sm">
            <caption className="sr-only">Line items</caption>
            <thead>
              <tr className="border-b border-rule text-left text-xs text-ink-3">
                <th scope="col" className="py-2 font-medium">Item</th>
                <th scope="col" className="py-2 text-right font-medium">Qty</th>
                <th scope="col" className="py-2 text-right font-medium">Unit</th>
                <th scope="col" className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it, i) => (
                <tr key={i} className="border-b border-rule/70">
                  <td className="py-2.5">{it.name}</td>
                  <td className="num py-2.5 text-right">{it.quantity}</td>
                  <td className="num py-2.5 text-right">{fmtMoney(it.unit_minor, inv.currency)}</td>
                  <td className="num py-2.5 text-right">{fmtMoney(it.subtotal_minor, inv.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="num mt-3 ml-auto w-60 space-y-1 text-sm">
            <p className="flex justify-between text-ink-2"><span>Subtotal</span><span>{fmtMoney(inv.subtotal_minor, inv.currency)}</span></p>
            <p className="flex justify-between text-ink-2"><span>Tax</span><span>{fmtMoney(inv.tax_minor, inv.currency)}</span></p>
            <p className="flex justify-between font-semibold"><span>Total (PayPal)</span><span>{fmtMoney(inv.total_minor, inv.currency)}</span></p>
            <p className="flex justify-between text-ink-2"><span>Paid</span><span>{fmtMoney(inv.paid_minor, inv.currency)}</span></p>
          </div>
        </section>

        <section aria-labelledby="tl-title" className="rounded-[var(--radius-panel)] border border-rule bg-sheet p-5 sm:p-6">
          <h2 id="tl-title" className="font-display text-xl font-semibold tracking-tight">Timeline</h2>
          {d.activity.length ? (
            <ol className="mt-4 space-y-4 border-l border-rule pl-4">
              {d.activity.map((a) => (
                <li key={a.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-sheet bg-ink-3" aria-hidden />
                  <p className="font-medium">{describeAudit(a)}</p>
                  <p className="text-xs text-ink-3">
                    {fmtRelative(a.at)}
                    {a.debug_id ? ` · debug ${a.debug_id}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-ink-3">No recorded activity for this invoice.</p>
          )}
        </section>
      </div>
    </div>
  );
}
