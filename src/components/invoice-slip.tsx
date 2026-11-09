"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import { Check, ExternalLink, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import type { ProposalDTO } from "@/lib/views";
import { api, ApiError, fmtDate, fmtMoney } from "@/lib/client";
import { Button, ErrorNote, Field, Input, SourceBadge, StatusBadge } from "./ui";

type Props = { proposal: ProposalDTO; onChange: (p: ProposalDTO) => void; currencies?: string[] };

export function ProposalCard(props: Props) {
  return props.proposal.kind === "send_reminder" ? <ReminderSlip {...props} /> : <InvoiceSlip {...props} />;
}

function useProposalActions(p: ProposalDTO, onChange: (p: ProposalDTO) => void) {
  const [busy, setBusy] = useState<null | "approve" | "cancel" | "save">(null);
  const [error, setError] = useState<{ message: string; debugId?: string } | null>(null);

  async function run(kind: "approve" | "cancel") {
    setBusy(kind);
    setError(null);
    try {
      const r = await api<{ proposal: ProposalDTO }>(`/api/proposals/${p.id}/${kind}`, { method: "POST", body: {} });
      onChange(r.proposal);
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, debugId: err.debugId });
      // Re-read the proposal so the card reflects the server's state (e.g. failed → retryable).
      api<{ proposal: ProposalDTO }>(`/api/proposals/${p.id}`).then((r) => onChange(r.proposal)).catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }
  return { busy, setBusy, error, setError, approve: () => run("approve"), cancel: () => run("cancel") };
}

function SlipFrame({ tone, children, label }: { tone: "pending" | "done" | "muted" | "failed"; children: React.ReactNode; label: string }) {
  return (
    <article
      aria-label={label}
      className={clsx(
        "perforated relative w-full max-w-[620px] overflow-hidden rounded-t-[var(--radius-sheet)] bg-sheet shadow-[var(--shadow-sheet)]",
        tone === "muted" && "opacity-70",
      )}
    >
      <div
        className={clsx(
          "h-1.5 w-full",
          tone === "pending" && "bg-canary",
          tone === "done" && "bg-ledger",
          tone === "muted" && "bg-rule-strong",
          tone === "failed" && "bg-rose-ink/60",
        )}
        aria-hidden
      />
      {children}
    </article>
  );
}

function InvoiceSlip({ proposal: p, onChange, currencies }: Props) {
  const inv = p.invoice!;
  const a = useProposalActions(p, onChange);
  const [editing, setEditing] = useState(false);
  const pending = p.status === "pending_approval" || p.status === "failed";
  const sent = p.status === "executed";
  const tone = sent ? "done" : p.status === "cancelled" ? "muted" : p.status === "failed" ? "failed" : "pending";
  const result = p.result_invoice;

  return (
    <SlipFrame tone={tone} label={`Invoice proposal for ${inv.client_name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 sm:px-6">
        <p className="text-sm font-medium text-ink-2">{sent ? "Invoice sent" : p.status === "cancelled" ? "Proposal cancelled" : "Invoice proposal"}</p>
        <StatusBadge status={p.status} />
      </div>

      {editing ? (
        <EditInvoiceForm
          proposal={p}
          currencies={currencies}
          onCancel={() => setEditing(false)}
          onSaved={(np) => {
            onChange(np);
            setEditing(false);
          }}
        />
      ) : (
        <div className="px-5 pb-6 pt-3 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className="text-xs text-ink-3">Bill to</p>
              <p className="font-display text-xl font-semibold tracking-tight">{inv.client_name}</p>
              <p className="truncate text-sm text-ink-2">{inv.client_email}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-ink-3">Issued</dt>
              <dd className="num text-right">{fmtDate(inv.issue_date)}</dd>
              <dt className="text-ink-3">Due</dt>
              <dd className="num text-right font-semibold">{fmtDate(inv.due_date)}</dd>
            </dl>
          </div>

          <table className="mt-5 w-full text-sm">
            <caption className="sr-only">Line items</caption>
            <thead>
              <tr className="border-b border-rule text-left text-xs text-ink-3">
                <th scope="col" className="py-2 font-medium">Item</th>
                <th scope="col" className="w-14 py-2 text-right font-medium">Qty</th>
                <th scope="col" className="w-28 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it, i) => (
                <tr key={i} className="border-b border-rule/70 align-top">
                  <td className="py-2.5 pr-3">
                    {it.name}
                    {it.description ? <span className="block text-xs text-ink-3">{it.description}</span> : null}
                  </td>
                  <td className="num py-2.5 text-right">{it.quantity}</td>
                  <td className="num py-2.5 text-right">{fmtMoney(it.subtotal_minor, inv.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="relative mt-3 flex flex-col items-end gap-1 text-sm">
            {sent && result ? <Stamp line2={result.source === "mock_paypal" ? "Mock PayPal" : "PayPal Sandbox"} /> : null}
            <p className="num flex w-56 justify-between text-ink-2">
              <span>Subtotal</span>
              <span>{fmtMoney(inv.subtotal_minor, inv.currency)}</span>
            </p>
            <p className="num flex w-56 justify-between text-ink-2">
              <span>
                {inv.tax_name} {inv.tax_milli / 1000}%
              </span>
              <span>{fmtMoney(inv.tax_minor, inv.currency)}</span>
            </p>
            <p className="num mt-1 flex w-56 items-baseline justify-between">
              <span className="text-sm font-medium">Total {inv.currency}</span>
              <span className="font-display text-2xl font-semibold tracking-tight">{fmtMoney(inv.total_minor, inv.currency)}</span>
            </p>
          </div>
          {inv.note ? <p className="mt-4 rounded bg-paper px-3 py-2 text-sm text-ink-2">{inv.note}</p> : null}

          {sent && result ? (
            <div className="relative mt-5 flex flex-wrap items-center gap-3 border-t border-rule pt-4 text-sm">
              <SourceBadge source={result.source} paypalId={result.paypal_invoice_id} />
              <span className="num font-medium">{result.paypal_invoice_id}</span>
              <StatusBadge status={result.status} />
              <Link href={`/app/invoices/${result.id}`} className="ml-auto font-medium text-stamp underline-offset-2 hover:underline">
                Track payment
              </Link>
            </div>
          ) : null}

          {a.error ? (
            <div className="mt-4">
              <ErrorNote message={a.error.message} debugId={a.error.debugId} />
            </div>
          ) : p.status === "failed" && p.error ? (
            <div className="mt-4">
              <ErrorNote message={`Last attempt failed: ${p.error}`} />
            </div>
          ) : null}

          {pending ? (
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-rule pt-4">
              <Button variant="primary" onClick={a.approve} loading={a.busy === "approve"} disabled={!!a.busy} icon={<Send className="size-4" aria-hidden />}>
                {p.status === "failed" ? "Retry approval" : "Approve & send via PayPal"}
              </Button>
              <Button onClick={() => setEditing(true)} disabled={!!a.busy} icon={<Pencil className="size-4" aria-hidden />}>
                Edit
              </Button>
              <Button variant="ghost" onClick={a.cancel} loading={a.busy === "cancel"} disabled={!!a.busy} icon={<X className="size-4" aria-hidden />}>
                Cancel
              </Button>
              <p className="w-full pt-1 text-xs text-ink-3">Nothing is sent to PayPal until you approve.</p>
            </div>
          ) : null}
        </div>
      )}
    </SlipFrame>
  );
}

function Stamp({ line2 }: { line2: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-1 top-1 flex animate-stamp flex-col items-center rounded-[6px] border-[3px] border-stamp px-3 py-1 text-stamp opacity-90 mix-blend-multiply"
      style={{ transform: "rotate(-9deg)" }}
    >
      <span className="font-display text-2xl font-extrabold leading-none tracking-[0.08em]">SENT</span>
      <span className="text-[10px] font-semibold">{line2}</span>
    </span>
  );
}

type DraftItem = { name: string; description?: string | null; quantity?: string | number | null; unit_amount: string | number };

function EditInvoiceForm({ proposal, currencies, onCancel, onSaved }: { proposal: ProposalDTO; currencies?: string[]; onCancel: () => void; onSaved: (p: ProposalDTO) => void }) {
  const d = proposal.draft!;
  const [form, setForm] = useState({
    client_name: d.client_name,
    client_email: d.client_email ?? "",
    currency: d.currency ?? "USD",
    tax_name: d.tax_name ?? "Tax",
    tax_percent: String(d.tax_percent ?? "0"),
    due_date: d.due_date ?? "",
    note: d.note ?? "",
  });
  const [items, setItems] = useState<DraftItem[]>(d.items.map((i) => ({ ...i, quantity: String(i.quantity ?? "1"), unit_amount: String(i.unit_amount) })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const id = (k: string) => `${proposal.id}-${k}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ proposal: ProposalDTO }>(`/api/proposals/${proposal.id}`, {
        method: "PATCH",
        body: { draft: { ...form, items, note: form.note || null } },
      });
      onSaved(r.proposal);
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 px-5 pb-6 pt-3 sm:px-6" aria-label="Edit invoice">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client name" htmlFor={id("name")}>
          <Input id={id("name")} value={form.client_name} onChange={set("client_name")} required />
        </Field>
        <Field label="Client email" htmlFor={id("email")}>
          <Input id={id("email")} type="email" value={form.client_email} onChange={set("client_email")} required />
        </Field>
        <Field label="Currency" htmlFor={id("cur")}>
          <select id={id("cur")} value={form.currency} onChange={set("currency")} className="h-10 rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-3 text-sm">
            {(currencies ?? [form.currency]).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Due date" htmlFor={id("due")}>
          <Input id={id("due")} type="date" value={form.due_date} onChange={set("due_date")} required />
        </Field>
        <Field label="Tax name" htmlFor={id("taxn")}>
          <Input id={id("taxn")} value={form.tax_name} onChange={set("tax_name")} />
        </Field>
        <Field label="Tax %" htmlFor={id("taxp")} hint="0–100, up to 3 decimals">
          <Input id={id("taxp")} inputMode="decimal" value={form.tax_percent} onChange={set("tax_percent")} />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Line items</legend>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_64px_104px_36px] gap-2">
            <Input aria-label={`Item ${i + 1} name`} value={it.name} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} required />
            <Input aria-label={`Item ${i + 1} quantity`} inputMode="decimal" value={String(it.quantity ?? "1")} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
            <Input aria-label={`Item ${i + 1} unit amount`} inputMode="decimal" value={String(it.unit_amount)} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, unit_amount: e.target.value } : x)))} />
            <button type="button" aria-label={`Remove item ${i + 1}`} disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))} className="grid place-items-center rounded text-ink-3 hover:bg-rose/40 hover:text-rose-ink disabled:opacity-30">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <Button type="button" size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} onClick={() => setItems([...items, { name: "", quantity: "1", unit_amount: "" }])}>
          Add item
        </Button>
      </fieldset>
      <Field label="Note to client" htmlFor={id("note")}>
        <textarea id={id("note")} value={form.note} onChange={set("note")} rows={2} className="w-full rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-3 py-2 text-sm focus:border-stamp focus:outline-none focus:ring-2 focus:ring-stamp/20" />
      </Field>
      {error ? <ErrorNote message={error} /> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={saving} icon={<Check className="size-4" aria-hidden />}>
          Save changes
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Discard
        </Button>
      </div>
    </form>
  );
}

function ReminderSlip({ proposal: p, onChange }: Props) {
  const r = p.reminder!;
  const a = useProposalActions(p, onChange);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(r.subject);
  const [note, setNote] = useState(r.note);
  const pending = p.status === "pending_approval" || p.status === "failed";
  const tone = p.status === "executed" ? "done" : p.status === "cancelled" ? "muted" : p.status === "failed" ? "failed" : "pending";

  async function save() {
    a.setBusy("save");
    a.setError(null);
    try {
      const res = await api<{ proposal: ProposalDTO }>(`/api/proposals/${p.id}`, { method: "PATCH", body: { reminder: { subject, note } } });
      onChange(res.proposal);
      setEditing(false);
    } catch (e) {
      a.setError({ message: (e as Error).message });
    } finally {
      a.setBusy(null);
    }
  }

  return (
    <SlipFrame tone={tone} label="Payment reminder proposal">
      <div className="space-y-3 px-5 pb-6 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink-2">
            Reminder for <span className="num text-ink">{p.result_invoice?.invoice_number ?? r.paypal_invoice_id}</span>
            {p.result_invoice ? <> · {fmtMoney(p.result_invoice.outstanding_minor, p.result_invoice.currency)} due</> : null}
          </p>
          <StatusBadge status={p.status === "executed" ? "executed" : p.status} />
        </div>
        {editing ? (
          <div className="space-y-3">
            <Field label="Subject" htmlFor={`${p.id}-subj`}>
              <Input id={`${p.id}-subj`} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label="Message" htmlFor={`${p.id}-note`}>
              <textarea id={`${p.id}-note`} rows={5} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-3 py-2 text-sm" />
            </Field>
            <div className="flex gap-2">
              <Button variant="primary" onClick={save} loading={a.busy === "save"}>
                Save changes
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Discard
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded border border-rule bg-paper/70 p-4">
            <p className="font-semibold">{r.subject}</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">{r.note}</p>
          </div>
        )}
        {a.error ? <ErrorNote message={a.error.message} debugId={a.error.debugId} /> : p.status === "failed" && p.error ? <ErrorNote message={p.error} /> : null}
        {p.status === "executed" ? (
          <p className="flex items-center gap-2 text-sm text-ledger">
            <Check className="size-4" aria-hidden /> PayPal sent the reminder{p.executed_at ? ` on ${fmtDate(p.executed_at)}` : ""}.
            {p.result_invoice ? (
              <Link href={`/app/invoices/${p.result_invoice.id}`} className="ml-auto inline-flex items-center gap-1 font-medium text-stamp hover:underline">
                Open invoice <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            ) : null}
          </p>
        ) : null}
        {pending && !editing ? (
          <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
            <Button variant="primary" onClick={a.approve} loading={a.busy === "approve"} disabled={!!a.busy} icon={<Send className="size-4" aria-hidden />}>
              Approve & send reminder
            </Button>
            <Button onClick={() => setEditing(true)} disabled={!!a.busy} icon={<Pencil className="size-4" aria-hidden />}>
              Edit
            </Button>
            <Button variant="ghost" onClick={a.cancel} loading={a.busy === "cancel"} disabled={!!a.busy}>
              Cancel
            </Button>
          </div>
        ) : null}
      </div>
    </SlipFrame>
  );
}
