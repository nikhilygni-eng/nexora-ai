# Devpost form: copy-paste sheet

Fill these in at paypalaihackathon.devpost.com → **Enter a Submission**. Submitting accepts the Official Rules in your name, so the final click is yours.

| Field | What to paste |
|---|---|
| Project name | `NEXORA AI` |
| Elevator pitch / tagline | From `title-and-tagline.md` |
| About the project (story) | All of `devpost-description.md` |
| Built with (tags) | `paypal`, `paypal-invoicing`, `gemini`, `google-genai`, `next.js`, `react`, `typescript`, `tailwindcss`, `ag-grid`, `recharts`, `sqlite`, `zod`, `playwright`, `vitest`, `k6`, `github-actions` |
| "Try it out" links | Hosted demo URL (if deployed) and `https://github.com/nikhilygni-eng/nexora-ai` |
| Code repository URL | `https://github.com/nikhilygni-eng/nexora-ai` (**must be public**) |
| Video demo link | The **Public** YouTube URL |
| Image gallery | The JPEGs in the `demo-output` branch → `shots/` (landing, slip, sent, analytics, insights, activity) |
| Sponsor prize | Read rules **section 8** first. If AG Grid's requirements fit, select **Best Use of AG Grid** |
| Testing instructions for judges | Below |

## Testing instructions (paste into the judges' field, not into the repo)

```
Hosted demo: <URL>   Passcode: <your APP_PASSCODE>

1. Sign in with the passcode. Demo invoices are pre-loaded and labeled "Demo data".
2. Command Center: type  Bill Acme Corp $800 for the landing page redesign, due in 14 days.
   NEXORA asks for the email (it never guesses one).
3. Reply with this PayPal Sandbox buyer email: <SANDBOX_BUYER_EMAIL>
   Review the invoice slip, optionally Edit (e.g. Tax 18%), then click "Approve & send via PayPal".
4. Click "Track payment" → "Open payer view in PayPal Sandbox". To pay, log in as the sandbox buyer:
   email <SANDBOX_BUYER_EMAIL>, password <sandbox buyer password>. Back in NEXORA, click
   "Refresh status from PayPal" and the status becomes Paid.
5. On an unpaid invoice: "Draft reminder with AI" → "Approve & send reminder".
6. Analytics: "Explain my receivables" (each insight shows the figures it used); sort/filter the AG Grid.
7. Activity log: every AI proposal, approval and PayPal call with HTTP status and PayPal debug ID.

Run locally instead: README → "Run it locally" (needs your own PayPal Sandbox app + Gemini key).
Everything runs in the PayPal Sandbox (test money).
```

## YouTube upload

- **Title:** `NEXORA AI: AI invoicing co-pilot with PayPal (PayPal AI Hackathon 2026)`
- **Visibility:** **Public** (not Unlisted, not Private)
- **Description:**
  ```
  NEXORA AI turns a plain-English request into a real PayPal invoice. An AI agent (Google Gemini) drafts it, asks when something is missing, and waits for your approval. Only then does the server create and send the invoice with the PayPal Invoicing v2 API (Sandbox). Payment status syncs back from PayPal, and analytics (AG Grid + charts) explain receivables with AI insights that cite only your own numbers.

  Code (MIT): https://github.com/nikhilygni-eng/nexora-ai
  Built for the PayPal AI Hackathon 2026. PayPal Sandbox only (test money).
  ```
- No music, or only YouTube Audio Library tracks.
