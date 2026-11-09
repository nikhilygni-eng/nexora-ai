# Testing status

Honest status of every feature. Updated 2026-11-09.

**Legend:** ✅ verified with real Sandbox · 🧪 tested with mocks · ⬜ untested · ⛔ blocked

| Feature | Status | How |
|---|---|---|
| Money: parse/format minor units, zero-decimal currencies, rounding | 🧪 | `tests/unit/money.test.ts` |
| Invoice draft validation (email, currency, tax, due dates, items) | 🧪 | `tests/unit/schema.test.ts` |
| AI output parsing (fenced JSON, malformed output), insight schema | 🧪 | `tests/unit/schema.test.ts` |
| Env guard: refuses non-sandbox PayPal URL; setup status hides secrets | 🧪 | `tests/unit/env.test.ts` |
| Session tokens (tamper, expiry, wrong passcode) | 🧪 | `tests/unit/env.test.ts` |
| PayPal client: request body, OAuth caching, `PayPal-Request-Id`, 401 refresh, network errors, error mapping + debug ID | 🧪 | `tests/unit/paypal-client.test.ts` (mocked HTTP) |
| Audit redaction of tokens/secrets | 🧪 | `tests/unit/paypal-client.test.ts` |
| Agent turn creates `pending_approval` proposal with zero PayPal writes | 🧪 | `tests/integration/approval-flow.test.ts` |
| Follow-up question when email missing; model-invented email rejected | 🧪 | integration test (scripted + "hallucinating" providers) |
| Approve → create + send exactly once under 3 concurrent clicks | 🧪 | integration test |
| Retry after failed send does not create a second PayPal invoice | 🧪 | integration test |
| Cancelled proposals can't execute | 🧪 | integration test |
| Reminder: drafting never sends; approve sends once; refused when paid | 🧪 | integration test |
| Status sync (SENT → PAID, paid amount) | 🧪 | integration test + E2E (mock PayPal) |
| Full UI flow: login, request, follow-up, edit, approve, track, AI reminder, simulated payment, activity log | 🧪 | `tests/e2e/main-flow.spec.ts` (Playwright, production build, mock PayPal + scripted provider) |
| Analytics page with AG Grid and labeled demo data | 🧪 | E2E |
| Real PayPal Sandbox: create → send → get → remind → cancel | ⛔ | `npm run test:sandbox` is ready; blocked until `PAYPAL_CLIENT_ID/SECRET` are in `.env.local` |
| Real AI via FreeLLMAPI (tool calling, structured output) | ⛔ | Blocked: no `FREELLMAPI_API_KEY` yet and the local router (`localhost:3001`) wasn't running |
| Real AI via Gemini | ⛔ | Blocked: no `GEMINI_API_KEY` yet |
| AI insights quality on real model | ⛔ | Needs an AI key |
| PayPal webhooks with signature verification | ⬜ | Implemented; needs a public URL + `PAYPAL_WEBHOOK_ID` |
| Responsive layout (390px mobile, 1440px desktop) | 🧪 | Playwright screenshots reviewed manually |
| Deployment (Render) | ⬜ | `render.yaml` prepared; deployment awaits owner approval |

## Commands

```bash
npm test                # 33 unit + integration tests
npm run test:e2e        # 3 Playwright tests (builds must exist: npm run build)
npm run test:sandbox    # real Sandbox, opt-in, skipped without credentials
```

## Last results (2026-11-09, cloud dev container)

- `npm test`: 33 passed
- `npm run test:e2e`: 3 passed
- `npm run test:sandbox`: 2 skipped (no credentials)
- `npm run lint`: clean · `npm run build`: success
