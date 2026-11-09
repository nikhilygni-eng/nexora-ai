# Roadmap

The hackathon build is one flawless core loop: **describe → draft → approve → PayPal → track → explain → remind**. Everything below builds on the same approval-gated architecture. None of it is built yet.

## Next (post-hackathon)

- **Postgres + multi-tenant auth.** Swap the repository layer to Postgres; real users, workspaces and sessions (queries are already org-scoped).
- **Client book (light CRM).** Client profiles with billing contacts, preferred currency, tax IDs and payment history; the agent uses them as trusted context.
- **Recurring invoices and subscriptions.** "Bill Northwind $4,500 on the 1st of every quarter" becomes a schedule. Each run still produces a proposal unless the user opts into auto-send for that schedule.
- **PayPal checkout on the invoice.** Embedded PayPal JS SDK button and Pay Later messaging on a NEXORA-hosted payment page.

## Later

- **Multi-agent collections.** A collections agent that watches aging, proposes reminder cadences per client, and escalates tone. A finance agent that reconciles payouts. A supervisor that batches proposals for one daily approval.
- **Teams and roles.** Owner / accountant / viewer roles with per-role approval limits (e.g. invoices above $5,000 need the owner).
- **Dispute assistant.** Summarizes a PayPal dispute, gathers evidence from invoice history and drafts a response for approval.
- **Workflow builder.** Visual rules ("when an invoice is 7 days late and over $1,000, draft a firm reminder and notify me on Slack").
- **Cash-flow forecasting.** Per-client payment behavior models, always labeled as estimates with their inputs shown.
- **FX-aware analytics.** Convert multi-currency receivables with dated rates.
