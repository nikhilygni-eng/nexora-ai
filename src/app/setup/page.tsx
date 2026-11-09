import Link from "next/link";
import { Check, X } from "lucide-react";
import { getSetupStatus } from "@/lib/env";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

/** Presence-only checklist: shows WHICH settings are missing, never their values. */
export default function SetupPage() {
  const s = getSetupStatus();
  const missing = s.items.filter((i) => i.required && !i.ok);
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <Link href="/">
        <Logo />
      </Link>
      <h1 className="mt-10 font-display text-4xl font-semibold tracking-[-0.02em]">Setup</h1>
      <p className="mt-2 text-ink-2">
        Add these to <code className="rounded bg-sheet px-1.5 py-0.5 text-sm">.env.local</code> in the project root, then restart the server. Start from{" "}
        <code className="rounded bg-sheet px-1.5 py-0.5 text-sm">.env.example</code>.
      </p>

      {s.configError ? (
        <div role="alert" className="mt-6 rounded-[var(--radius-control)] border border-rose-ink/25 bg-rose/40 p-4 text-sm text-rose-ink">
          {s.configError}
        </div>
      ) : null}

      <ul className="mt-8 divide-y divide-rule overflow-hidden rounded-[var(--radius-panel)] border border-rule bg-sheet">
        {s.items.map((i) => (
          <li key={i.key} className="flex gap-4 p-4">
            <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${i.ok ? "bg-ledger-tint text-ledger" : "bg-rose text-rose-ink"}`}>
              {i.ok ? <Check className="size-3.5" aria-label="Set" /> : <X className="size-3.5" aria-label="Missing" />}
            </span>
            <div className="min-w-0">
              <p className="font-medium">
                {i.label} <code className="ml-1 text-xs text-ink-3">{i.key}</code>
              </p>
              <p className="text-sm text-ink-3">{i.help}</p>
            </div>
          </li>
        ))}
      </ul>

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-[var(--radius-control)] border border-rule bg-sheet p-4">
          <dt className="text-ink-3">PayPal mode</dt>
          <dd className="mt-1 font-medium">{s.paypalMode === "mock" ? "Mock (local fake, labeled)" : "PayPal Sandbox"}</dd>
        </div>
        <div className="rounded-[var(--radius-control)] border border-rule bg-sheet p-4">
          <dt className="text-ink-3">AI provider</dt>
          <dd className="mt-1 font-medium">
            {s.aiProvider === "freellmapi" ? "FreeLLMAPI" : s.aiProvider === "gemini" ? "Google Gemini" : "Scripted test provider"} · {s.aiModel}
          </dd>
        </div>
      </dl>

      <p className="mt-8 text-sm">
        {missing.length ? (
          <span className="text-ink-2">{missing.length} required setting{missing.length > 1 ? "s" : ""} missing.</span>
        ) : (
          <Link href="/app" className="font-semibold text-stamp hover:underline">
            Everything is set. Open the workspace
          </Link>
        )}
      </p>
    </main>
  );
}
