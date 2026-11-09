"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, Database, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import { Button, ErrorNote, Field, Input, PageHeader, Spinner } from "@/components/ui";

type Settings = {
  name: string;
  business_email: string | null;
  default_currency: string;
  default_tax_name: string;
  default_tax_percent: string;
  default_terms_days: number;
};

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [demoBusy, setDemoBusy] = useState<null | "seed" | "clear">(null);
  const [demoMsg, setDemoMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ settings: Settings; currencies: string[] }>("/api/settings");
      setS(r.settings);
      setCurrencies(r.currencies);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await api<{ settings: Settings }>("/api/settings", { method: "PATCH", body: { ...s, business_email: s.business_email ?? "" } });
      setS(r.settings);
      setSaved(true);
    } catch (e2) {
      setError((e2 as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function demo(action: "seed" | "clear") {
    setDemoBusy(action);
    setDemoMsg(null);
    try {
      const r = await api<{ created?: number; skipped?: boolean }>("/api/demo", { body: { action } });
      setDemoMsg(action === "clear" ? "Demo data removed." : r.skipped ? "Demo data is already loaded." : `Loaded ${r.created} demo invoices, labeled “Demo data”.`);
    } catch (e) {
      setDemoMsg((e as Error).message);
    } finally {
      setDemoBusy(null);
    }
  }

  if (!s && !error) return <Spinner label="Loading settings" />;
  const set = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setSaved(false);
    setS({ ...s!, [k]: e.target.value });
  };

  return (
    <>
      <PageHeader title="Settings" description="Defaults the AI uses when your request doesn't say otherwise." />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        {s ? (
          <form onSubmit={save} className="space-y-6 rounded-[var(--radius-panel)] border border-rule bg-sheet p-5 sm:p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Business name" htmlFor="s-name">
                <Input id="s-name" value={s.name} onChange={set("name")} required />
              </Field>
              <Field label="Business email" htmlFor="s-email" hint="Optional. For your reference; PayPal uses your Sandbox account.">
                <Input id="s-email" type="email" value={s.business_email ?? ""} onChange={set("business_email")} />
              </Field>
              <Field label="Default currency" htmlFor="s-cur">
                <select id="s-cur" value={s.default_currency} onChange={set("default_currency")} className="h-10 rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-3 text-sm">
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Payment terms (days)" htmlFor="s-terms" hint="Used when a request has no due date.">
                <Input id="s-terms" type="number" min={0} max={365} value={s.default_terms_days} onChange={set("default_terms_days")} />
              </Field>
              <Field label="Default tax name" htmlFor="s-taxn" hint="e.g. GST, VAT, Sales tax">
                <Input id="s-taxn" value={s.default_tax_name} onChange={set("default_tax_name")} required />
              </Field>
              <Field label="Default tax %" htmlFor="s-taxp" hint="0 to disable. Up to 3 decimals.">
                <Input id="s-taxp" inputMode="decimal" value={s.default_tax_percent} onChange={set("default_tax_percent")} />
              </Field>
            </div>
            {error ? <ErrorNote message={error} /> : null}
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" loading={saving}>
                Save settings
              </Button>
              {saved ? (
                <span className="inline-flex items-center gap-1 text-sm text-ledger" role="status">
                  <Check className="size-4" aria-hidden /> Saved
                </span>
              ) : null}
            </div>
          </form>
        ) : (
          <ErrorNote message={error!} onRetry={load} />
        )}

        <div className="space-y-4">
          <section className="rounded-[var(--radius-panel)] border border-rule bg-sheet p-5" aria-labelledby="demo-title">
            <h2 id="demo-title" className="font-display text-lg font-semibold tracking-tight">Demo data</h2>
            <p className="mt-1 text-sm text-ink-2">
              15 sample invoices to explore Analytics. They are labeled “Demo data”, never sent to PayPal, and can be removed anytime.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => demo("seed")} loading={demoBusy === "seed"} icon={<Database className="size-4" aria-hidden />}>
                Load demo data
              </Button>
              <Button size="sm" variant="danger" onClick={() => demo("clear")} loading={demoBusy === "clear"} icon={<Trash2 className="size-4" aria-hidden />}>
                Remove demo data
              </Button>
            </div>
            {demoMsg ? <p className="mt-3 text-sm text-ink-2" role="status">{demoMsg}</p> : null}
          </section>
          <section className="rounded-[var(--radius-panel)] border border-rule bg-sheet p-5">
            <h2 className="font-display text-lg font-semibold tracking-tight">Connections</h2>
            <p className="mt-1 text-sm text-ink-2">PayPal and AI keys live in .env.local on the server, never in the browser.</p>
            <Link href="/setup" className="mt-3 inline-block text-sm font-semibold text-stamp hover:underline">
              View setup checklist
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
