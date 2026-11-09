import Link from "next/link";
import { Logo } from "@/components/logo";

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-2 text-sm">
          <a href="#how" className="hidden rounded px-3 py-2 text-ink-2 hover:text-ink sm:inline">
            How it works
          </a>
          <Link href="/app" className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-ink px-4 font-medium text-white hover:bg-ink-2">
            Open workspace
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-8 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:pt-16">
          <div>
            <h1 className="font-display text-[clamp(2.4rem,4.6vw,3.9rem)] font-bold leading-[1.02] tracking-[-0.035em] text-ink">
              Say who owes you.
              <br />
              Approve the invoice.
              <br />
              PayPal does the rest.
            </h1>
            <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-ink-2">
              NEXORA turns a sentence into a real PayPal invoice for your international clients. It asks when details are missing, waits for your approval, then tracks
              payment and tells you who to chase.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/app" className="inline-flex h-12 items-center rounded-[var(--radius-control)] bg-stamp px-5 font-medium text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)] hover:bg-stamp-deep">
                Draft my first invoice
              </Link>
              <span className="text-sm text-ink-3">Runs on PayPal Sandbox. Test money only.</span>
            </div>
          </div>

          {/* Hero: request → slip → stamp */}
          <div className="relative" aria-label="Example: a request becomes a PayPal invoice" role="img">
            <div className="ruled rounded-[var(--radius-panel)] border border-rule bg-sheet px-6 pb-10 pt-6 sm:px-8">
              <p className="text-xs font-medium text-ink-3">You type</p>
              <p className="mt-2 font-display text-[1.35rem] leading-[1.35] tracking-[-0.01em] text-ink sm:text-2xl">
                “Bill Acme Corp $800 for the landing page redesign, due in 14 days.”
              </p>
            </div>
            <div className="perforated relative -mt-6 ml-4 mr-[-0.5rem] rounded-t-[var(--radius-sheet)] bg-sheet shadow-[var(--shadow-sheet)] sm:ml-10">
              <div className="h-1.5 bg-ledger" />
              <div className="px-6 pb-7 pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs text-ink-3">Bill to</p>
                    <p className="font-display text-xl font-semibold tracking-tight">Acme Corp</p>
                    <p className="text-sm text-ink-2">ap@acme.com</p>
                  </div>
                  <div className="num text-right text-sm">
                    <p className="text-ink-3">Due</p>
                    <p className="font-semibold">Nov 23, 2026</p>
                  </div>
                </div>
                <div className="perforated-line my-4" />
                <div className="num flex justify-between text-sm">
                  <span>Landing page redesign</span>
                  <span>$800.00</span>
                </div>
                <div className="num mt-4 flex items-baseline justify-between gap-4">
                  <span className="text-sm font-medium">Total USD</span>
                  <span className="font-display text-3xl font-semibold tracking-tight">$800.00</span>
                </div>
                <p className="num mt-5 max-w-[60%] pb-4 text-xs text-ink-3">PayPal invoice INV2-XXXX-XXXX, status SENT</p>
              </div>
              <span
                aria-hidden
                className="absolute bottom-5 right-5 flex origin-bottom-right scale-[0.8] animate-stamp sm:scale-100 flex-col items-center rounded-[6px] border-[3px] border-stamp px-3 py-1 text-stamp mix-blend-multiply [animation-delay:500ms]"
              >
                <span className="font-display text-3xl font-extrabold leading-none tracking-[0.08em]">SENT</span>
                <span className="text-[10px] font-semibold">PayPal Sandbox</span>
              </span>
            </div>
          </div>
        </section>

        <section id="how" className="border-t border-rule bg-sheet">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="font-display text-4xl font-semibold leading-[1.05] tracking-[-0.025em]">You stay the one who sends.</h2>
              <p className="mt-4 max-w-[48ch] text-ink-2">
                The AI can read your invoices and draft new ones. It can&apos;t send anything. Every PayPal invoice and reminder needs your click, and every call is in the
                activity log with PayPal&apos;s debug ID.
              </p>
            </div>
            <ol className="grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-rule bg-rule sm:grid-cols-2">
              {[
                ["Describe the job", "Any of PayPal's 25 currencies, with your tax rate and terms."],
                ["Review the draft", "Line items, tax and due date on one slip. Edit anything."],
                ["Approve to send", "NEXORA creates and sends the invoice through PayPal Invoicing."],
                ["Get paid, see why", "Status syncs from PayPal. Analytics explain who's late and what to do."],
              ].map(([t, b], i) => (
                <li key={t} className="bg-paper p-6">
                  <span className="num font-display text-sm font-semibold text-ink-3">Step {i + 1}</span>
                  <p className="mt-2 font-display text-xl font-semibold tracking-tight">{t}</p>
                  <p className="mt-1 text-sm text-ink-2">{b}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
          <div className="grid gap-10 md:grid-cols-3">
            {[
              ["Never guesses an email", "If the client's address isn't in your message or your saved clients, NEXORA asks. Invented addresses are rejected server-side."],
              ["Money in minor units", "Amounts are stored as integers and sent to PayPal as exact decimal strings. Zero-decimal currencies like JPY are handled."],
              ["Honest numbers", "Insights only cite figures computed from your data. Demo rows are labeled and forecasts are marked as estimates."],
            ].map(([t, b]) => (
              <div key={t}>
                <h3 className="font-display text-xl font-semibold tracking-tight">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{b}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-ink-3 sm:px-8">
          <Logo />
          <p>Built for the PayPal AI Hackathon 2026. Sandbox only. MIT licensed.</p>
        </div>
      </footer>
    </div>
  );
}
