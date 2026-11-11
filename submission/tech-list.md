# Built with

- PayPal Invoicing v2 REST API (Sandbox): create, send, get, remind, cancel
- PayPal OAuth 2.0 client credentials, unique invoice numbers + search-based recovery for idempotency, webhook signature verification
- Google Gemini (@google/genai, gemini-3.5-flash-lite) behind a provider-agnostic interface (FreeLLMAPI/OpenAI-compatible also supported)
- Next.js 15 (App Router), React 19, TypeScript (strict)
- Tailwind CSS 4
- AG Grid Community (ag-grid-react)
- Recharts
- SQLite (better-sqlite3)
- zod
- Vitest, Playwright, k6 (load testing), GitHub Actions (CI, uptime checks, demo recording)
