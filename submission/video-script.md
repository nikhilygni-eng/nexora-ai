# Demo video: script and shot list (target 2:45, hard limit < 3:00)

Record at 1440×900, browser zoom 100%, real PayPal Sandbox, real AI provider. No third-party music without a license.

| Time | Shot | Voice-over |
|---|---|---|
| 0:00–0:15 | Landing page hero; stamp lands | "Freelancers billing international clients lose hours to invoices and chasing payments. NEXORA is an AI co-pilot that turns a sentence into a real PayPal invoice, but never sends anything without you." |
| 0:15–0:35 | Command Center, type the Acme request | "I just say what to bill. The agent pulls out the client, amount, currency and due date, and checks my saved clients." |
| 0:35–0:50 | Agent asks for the email; reply with the sandbox buyer email | "It doesn't know Acme's email, so it asks. NEXORA never guesses an address. The server rejects any email I didn't give it." |
| 0:50–1:10 | Slip appears; click Edit, add GST 18%, save; totals update | "Here's the draft. I can change anything. Tax is configurable, and amounts are validated on the server in exact minor units." |
| 1:10–1:30 | Click Approve; stamp; real INV2 ID | "Only my click sends it. The server creates and sends the invoice through PayPal's Invoicing API, with idempotency keys so a double click can't send twice." |
| 1:30–1:55 | Track payment → PayPal payer view in sandbox → pay as buyer → Refresh status → Paid | "Here's what the client sees in PayPal. I'll pay as the sandbox buyer, and NEXORA pulls the new status straight from PayPal." |
| 1:55–2:15 | Analytics: KPI tiles, charts, AG Grid sort/filter | "Analytics updates from real data. Demo rows are clearly labeled, and the collections forecast is marked as an estimate." |
| 2:15–2:30 | Explain my receivables → insights with "Based on" figures | "The AI explains my receivables, and every insight cites the exact figures it used. If it invents a number, NEXORA throws the insight away." |
| 2:30–2:40 | Unpaid invoice → Draft reminder with AI → Approve | "For late clients, it drafts a reminder. PayPal sends it after I approve." |
| 2:40–2:50 | Activity log with PayPal endpoints and debug IDs | "Every AI proposal, approval and PayPal call is logged with PayPal's debug ID." |
| 2:50–2:55 | Logo | "NEXORA: say who owes you, approve, and PayPal does the rest." |

## Pre-recording checklist

- [ ] `.env.local` has Sandbox credentials + AI key; `/setup` all green
- [ ] Fresh database; demo data loaded; one previously sent unpaid PayPal invoice exists for the reminder shot
- [ ] Sandbox Personal (buyer) account email and password at hand
- [ ] Browser: no bookmarks bar, no extensions visible, notifications off
