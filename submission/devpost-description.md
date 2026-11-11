## Inspiration

Freelancers who bill international clients spend their evenings on invoicing admin: re-typing client details, getting tax and currency right, remembering who's late, writing awkward reminders. AI can write an invoice, but nobody should let a chatbot **send** one. They guess email addresses, invent numbers and act without asking. We wanted an AI that does the tedious part and leaves the decision with you.

## What it does

You type: *"Bill Acme Corp $800 for the landing page redesign, due in 14 days."*

1. **NEXORA's agent** extracts the client, line items, currency, tax and due date. It searches your saved clients, and if the email isn't known, it **asks** instead of guessing.
2. It produces an **invoice slip** for review. You can edit anything. Nothing has touched PayPal yet.
3. You click **Approve & send via PayPal**. The server creates the invoice with the **PayPal Invoicing v2 API**, sends it, and confirms its real status from PayPal. The slip is stamped *SENT* with the real `INV2-…` ID.
4. Status **syncs from PayPal** (polling, a refresh button, and verified webhooks), so the invoices list and the dashboard update when the client pays.
5. **Analytics** (AG Grid + charts) shows outstanding, overdue, aging and days-to-pay. **Explain my receivables** asks the AI for insights that must cite the computed figures. Anything citing a number that isn't in your data is discarded.
6. For late invoices, the AI **drafts a reminder**. PayPal sends it only after you approve.

## How we built it

- **Agent with typed tools** (`draft_invoice`, `find_client`, `list_invoices`, `get_invoice_status`, `summarize_receivables`, `draft_reminder`), every argument and output validated with zod.
- **Approval gating by construction:** write tools only create `pending_approval` proposals. The one PayPal write path is a separate endpoint behind the user's click, with an atomic compare-and-set so double clicks execute once, plus a deterministic PayPal invoice number per proposal, so a retry after a lost response finds the existing invoice instead of creating a duplicate.
- **Server-side anti-hallucination:** an email is accepted only if the user typed it or it belongs to a saved client.
- **Google Gemini** (`gemini-3.5-flash-lite` via `@google/genai`) behind a provider-agnostic interface; an OpenAI-compatible router (FreeLLMAPI) also works for local runs.
- **Money done right:** integer minor units in the database, exact decimal strings for PayPal, zero-decimal currencies (JPY, HUF, TWD) handled, configurable tax.
- **Audit log** of every AI proposal, approval and PayPal call with HTTP status and PayPal debug ID, with secrets redacted.
- **Built for traffic spikes:** a process-wide AI traffic gate (concurrency cap, queue, pacing to the model quota, cooldown after 429s) so overload returns "try again in N seconds" instead of errors; cached insights; timeouts and retries; error boundaries; a health check and uptime monitor. Load-tested with k6 at 300 concurrent virtual users (mock PayPal and simulated AI, so it measures NEXORA's own server, not Gemini or PayPal capacity): 50,090 requests in 3 minutes, 0% errors, p95 read latency 621 ms, and every AI request beyond the quota got a polite "try again".
- Next.js 15, TypeScript strict, SQLite, AG Grid Community, Recharts, Tailwind. 60 unit/integration tests, Playwright E2E, an opt-in test against the real Sandbox, and CI on every push.

## Challenges

- Making an LLM agent **safe to connect to a payments API**: we moved every safety rule (approval, email provenance, validation, idempotency) out of the prompt and into server code the model can't bypass.
- Getting money right across 25 currencies without floats.
- Keeping AI insights honest: computing facts deterministically first, then forcing the model to cite them.
- Staying up when everyone clicks at once: the free AI tier allows 15 requests a minute, so the server queues and paces model calls itself instead of letting users hit the provider's limit.

## Accomplishments

- A full loop from one sentence to a real PayPal Sandbox invoice to payment tracking, with no PayPal write that a person didn't approve.
- Concurrency-safe approvals: three simultaneous approve clicks produce exactly one PayPal invoice (tested).

## What we learned

The interesting part of "AI + payments" isn't generating text. It's designing the boundary between what the model may do on its own (read, draft, explain) and what only a human may trigger (send, remind).

## What's next

Recurring invoices, a client book, multi-agent collections with daily batched approvals, team roles with approval limits, and a PayPal dispute assistant. See ROADMAP.md.

## Data honesty

Runs on the PayPal **Sandbox** only (test money). Seeded demo rows are labeled *Demo data*; forecasts are labeled *Estimate*.
