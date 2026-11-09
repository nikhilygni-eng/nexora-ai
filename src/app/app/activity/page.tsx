"use client";

import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import type { AuditRow } from "@/lib/audit";
import { api, fmtRelative } from "@/lib/client";
import { describeAudit } from "@/components/audit-text";
import { EmptyState, ErrorNote, PageHeader, Spinner } from "@/components/ui";

const ACTORS: Record<string, { label: string; cls: string }> = {
  user: { label: "You", cls: "bg-ink text-white" },
  ai: { label: "AI", cls: "bg-stamp-tint text-stamp-deep" },
  paypal: { label: "PayPal", cls: "bg-canary text-canary-ink" },
  system: { label: "System", cls: "bg-paper text-ink-2 border border-rule" },
};

export default function ActivityPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSyncs, setShowSyncs] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await api<{ entries: AuditRow[] }>("/api/activity")).entries);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const visible = (rows ?? []).filter((r) => showSyncs || r.action !== "paypal.invoice.synced");

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Every AI proposal, approval and PayPal call, with HTTP status and PayPal debug ID. Tokens and secrets are never logged."
        actions={
          <label className="inline-flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={showSyncs} onChange={(e) => setShowSyncs(e.target.checked)} className="size-4 accent-[var(--stamp)]" />
            Show routine status checks
          </label>
        }
      />
      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {!rows && !error ? <Spinner label="Loading activity" /> : null}
      {rows && !visible.length ? <EmptyState title="No activity yet" body="Actions you take, AI proposals and PayPal calls will appear here." /> : null}
      {visible.length ? (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-rule bg-sheet">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Audit log</caption>
            <thead className="border-b border-rule bg-paper/60 text-left text-xs text-ink-3">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">When</th>
                <th scope="col" className="px-3 py-3 font-medium">Who</th>
                <th scope="col" className="px-3 py-3 font-medium">What</th>
                <th scope="col" className="px-3 py-3 font-medium">PayPal call</th>
                <th scope="col" className="px-5 py-3 font-medium">Debug ID / invoice</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const a = ACTORS[r.actor] ?? ACTORS.system;
                const failed = r.action.endsWith("_failed") || r.action.endsWith(".failed") || r.action === "webhook.rejected";
                return (
                  <tr key={r.id} className="border-b border-rule/70 align-top last:border-0">
                    <td className="whitespace-nowrap px-5 py-3 text-ink-3" title={r.at}>{fmtRelative(r.at)}</td>
                    <td className="px-3 py-3">
                      <span className={clsx("inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold", a.cls)}>{a.label}</span>
                    </td>
                    <td className={clsx("px-3 py-3", failed && "text-rose-ink")}>
                      {describeAudit(r)}
                      {failed && r.details_json ? <span className="block text-xs">{safeErr(r.details_json)}</span> : null}
                    </td>
                    <td className="num px-3 py-3 text-xs text-ink-2">
                      {r.paypal_endpoint ? (
                        <>
                          {r.paypal_endpoint}
                          {r.http_status ? <span className="ml-1 font-semibold">→ {r.http_status}</span> : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num break-all px-5 py-3 text-xs text-ink-2">
                      {r.debug_id ?? ""}
                      {r.paypal_invoice_id ? <span className="block">{r.paypal_invoice_id}</span> : null}
                      {!r.debug_id && !r.paypal_invoice_id ? "—" : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function safeErr(json: string) {
  try {
    return (JSON.parse(json) as { error?: string }).error ?? "";
  } catch {
    return "";
  }
}
