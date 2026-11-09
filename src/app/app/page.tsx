"use client";

import clsx from "clsx";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, CircleAlert, RotateCcw, Sparkles } from "lucide-react";
import type { ProposalDTO } from "@/lib/views";
import { api, ApiError } from "@/lib/client";
import { ProposalCard } from "@/components/invoice-slip";
import { providerName } from "@/components/shell";
import { Button, ErrorNote, Spinner } from "@/components/ui";

type Trace = { tool: string; label: string; ok: boolean; readOnly: boolean; summary?: string };
type Msg = { key: string; role: "user" | "assistant"; text: string; at: string; trace?: Trace[]; error?: boolean };
type Setup = { aiReady: boolean; paypalReady: boolean; aiProvider: string; aiModel: string; paypalMode: string };

const SUGGESTIONS = [
  "Bill Acme Corp $800 for the landing page redesign, due in 14 days.",
  "Invoice Kumo Studio €1,200 for 3 days of UX workshops at €400/day, 19% VAT, due Dec 1.",
  "Which invoices are overdue, and who owes me the most?",
  "Draft a friendly reminder for my oldest unpaid PayPal invoice.",
];

export default function CommandCenter() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [proposals, setProposals] = useState<ProposalDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [s, h, st] = await Promise.all([
        api<Setup>("/api/setup"),
        api<{ conversationId: string | null; messages: { role: "user" | "assistant"; text: string; at: string }[]; proposals: ProposalDTO[] }>("/api/agent"),
        api<{ currencies: string[] }>("/api/settings"),
      ]);
      setSetup(s);
      setCurrencies(st.currencies);
      setConversationId(h.conversationId);
      setMessages(h.messages.map((m, i) => ({ ...m, key: `h${i}` })));
      setProposals(h.proposals);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, proposals.length, sending]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || sending) return;
    setSending(true);
    setSendError(null);
    setInput("");
    const now = new Date().toISOString();
    setMessages((m) => [...m, { key: `u${Date.now()}`, role: "user", text: msg, at: now }]);
    try {
      const r = await api<{ conversationId: string; reply: string; trace: Trace[]; proposals: ProposalDTO[] }>("/api/agent", {
        body: { conversationId, message: msg },
      });
      setConversationId(r.conversationId);
      setMessages((m) => [...m, { key: `a${Date.now()}`, role: "assistant", text: r.reply, at: new Date().toISOString(), trace: r.trace }]);
      if (r.proposals.length) setProposals((p) => [...p, ...r.proposals]);
    } catch (e) {
      const err = e as ApiError;
      setSendError(err.message);
      setMessages((m) => [...m, { key: `e${Date.now()}`, role: "assistant", text: err.message, at: new Date().toISOString(), error: true }]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setProposals([]);
    setSendError(null);
    inputRef.current?.focus();
  }

  const updateProposal = (np: ProposalDTO) => setProposals((ps) => ps.map((p) => (p.id === np.id ? np : p)));

  // Interleave messages and proposals chronologically.
  const items = [
    ...messages.map((m) => ({ t: m.at, kind: "msg" as const, m })),
    ...proposals.map((p) => {
      const reply = messages.find((m) => m.role === "assistant" && m.at >= p.created_at);
      return { t: reply ? reply.at + "~" : p.created_at, kind: "prop" as const, p };
    }),
  ].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.kind === "msg" && a.m.role === "user" ? -1 : 0));

  const aiOff = setup && !setup.aiReady;
  const pendingCount = proposals.filter((p) => p.status === "pending_approval").length;

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section aria-labelledby="cc-title" className="flex min-h-[calc(100dvh-10rem)] flex-col">
        <header className="flex flex-wrap items-end justify-between gap-3 pb-6">
          <div>
            <h1 id="cc-title" className="font-display text-3xl font-semibold tracking-[-0.02em] sm:text-[2.5rem] sm:leading-[1.05]">
              Command Center
            </h1>
            <p className="mt-2 text-sm text-ink-2">Describe what to bill. You review every invoice before PayPal sends it.</p>
          </div>
          {messages.length ? (
            <Button variant="ghost" size="sm" onClick={newConversation} icon={<RotateCcw className="size-4" aria-hidden />}>
              New conversation
            </Button>
          ) : null}
        </header>

        {aiOff ? (
          <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-canary-ink/25 bg-canary/60 px-5 py-4 text-sm text-canary-ink">
            <CircleAlert className="size-5 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1">
              <strong className="font-semibold">AI not configured.</strong> Add {setup.aiProvider === "gemini" ? "GEMINI_API_KEY" : "FREELLMAPI_API_KEY"} to
              .env.local and restart. Invoices and analytics still work.
            </p>
            <Link href="/setup" className="font-semibold underline underline-offset-2">
              Open setup
            </Link>
          </div>
        ) : null}

        <div className="flex-1 space-y-6" aria-live="polite" aria-busy={sending}>
          {loading ? <Spinner label="Loading conversation" /> : null}
          {loadError ? <ErrorNote message={loadError} onRetry={load} /> : null}

          {!loading && !items.length ? (
            <div className="ruled rounded-[var(--radius-panel)] border border-rule bg-sheet px-6 py-8 sm:px-8">
              <p className="font-display text-2xl font-semibold tracking-tight">Who owes you, and for what?</p>
              <p className="mt-2 max-w-prose text-sm text-ink-2">
                Write it the way you&apos;d tell a colleague. NEXORA fills in the invoice, asks if something is missing, and waits for your approval.
              </p>
              <ul className="mt-6 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <li key={s}>
                    <button
                      disabled={!!aiOff}
                      onClick={() => send(s)}
                      className="h-full w-full rounded-[var(--radius-control)] border border-rule bg-paper px-4 py-3 text-left text-sm text-ink transition-colors hover:border-stamp/50 hover:bg-stamp-tint disabled:opacity-50"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {items.map((it) =>
            it.kind === "msg" ? (
              <Message key={it.m.key} m={it.m} />
            ) : (
              <div key={it.p.id} className="pl-0 sm:pl-11">
                <ProposalCard proposal={it.p} onChange={updateProposal} currencies={currencies} />
              </div>
            ),
          )}

          {sending ? (
            <div className="flex items-center gap-3 pl-0 sm:pl-11">
              <span className="flex gap-1" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 rounded-full bg-ink-3 motion-safe:animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />
                ))}
              </span>
              <span className="text-sm text-ink-3">Working on it…</span>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="sticky bottom-4 mt-8"
        >
          <label htmlFor="composer" className="sr-only">
            Billing request
          </label>
          <div className="flex items-end gap-2 rounded-[var(--radius-panel)] border border-rule-strong bg-sheet p-2 shadow-[var(--shadow-lift)] focus-within:border-stamp">
            <textarea
              id="composer"
              ref={inputRef}
              rows={1}
              value={input}
              disabled={!!aiOff}
              maxLength={2000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={aiOff ? "AI isn't configured yet" : "Bill Northwind $2,400 for the Q4 retainer, due in 30 days…"}
              className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[15px] placeholder:text-ink-3 focus:outline-none"
            />
            <Button type="submit" variant="primary" disabled={!input.trim() || sending || !!aiOff} loading={sending} aria-label="Send" className="size-11 shrink-0 !px-0">
              {sending ? null : <ArrowUp className="size-5" aria-hidden />}
            </Button>
          </div>
          {sendError ? <p className="sr-only" role="alert">{sendError}</p> : null}
        </form>
      </section>

      <aside className="hidden space-y-4 xl:block" aria-label="How approval works">
        <div className="rounded-[var(--radius-panel)] border border-rule bg-sheet p-5">
          <h2 className="font-display text-lg font-semibold tracking-tight">How it works</h2>
          <ol className="mt-4 space-y-4 text-sm">
            {[
              ["You describe the job", "Plain English, any currency PayPal supports."],
              ["NEXORA drafts the invoice", "It checks saved clients and asks for anything missing. It never guesses an email."],
              ["You approve", "Only your click creates and sends the PayPal invoice."],
              ["PayPal tracks payment", "Status syncs from PayPal and updates Analytics."],
            ].map(([t, b], i) => (
              <li key={t} className="grid grid-cols-[24px_1fr] gap-3">
                <span className="num grid size-6 place-items-center rounded-full border border-rule-strong text-xs font-semibold text-ink-2">{i + 1}</span>
                <span>
                  <span className="block font-medium">{t}</span>
                  <span className="text-ink-3">{b}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        {setup ? (
          <div className="rounded-[var(--radius-panel)] border border-rule bg-sheet p-5 text-sm">
            <p className="text-ink-3">Model</p>
            <p className="mt-0.5 flex items-center gap-2 font-medium">
              <Sparkles className="size-4 text-stamp" aria-hidden />
              {setup.aiReady ? `${providerName(setup.aiProvider)} · ${setup.aiModel}` : "Not configured"}
            </p>
            {pendingCount ? <p className="mt-3 text-canary-ink">{pendingCount} draft{pendingCount > 1 ? "s" : ""} awaiting your approval</p> : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function Message({ m }: { m: Msg }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[80%] whitespace-pre-wrap rounded-[var(--radius-panel)] rounded-br-sm bg-ink px-4 py-3 text-[15px] leading-relaxed text-white">{m.text}</p>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className={clsx("grid size-8 shrink-0 place-items-center rounded-full", m.error ? "bg-rose text-rose-ink" : "bg-stamp-tint text-stamp")} aria-hidden>
        {m.error ? <CircleAlert className="size-4" /> : <Sparkles className="size-4" />}
      </span>
      <div className="min-w-0 max-w-[80ch] space-y-2 pt-1">
        {m.trace?.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Steps the assistant took">
            {m.trace.map((t, i) => (
              <li
                key={i}
                title={t.summary}
                className={clsx(
                  "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs",
                  t.ok ? "border-rule bg-sheet text-ink-2" : "border-canary-ink/25 bg-canary/50 text-canary-ink",
                )}
              >
                {t.ok ? <Check className="size-3" aria-hidden /> : <CircleAlert className="size-3" aria-hidden />}
                {t.label}
              </li>
            ))}
          </ul>
        ) : null}
        <p className={clsx("whitespace-pre-wrap text-[15px] leading-relaxed", m.error ? "text-rose-ink" : "text-ink")}>{m.text}</p>
      </div>
    </div>
  );
}
