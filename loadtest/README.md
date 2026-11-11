# Load testing NEXORA

`nexora-k6.js` simulates many signed-in people using NEXORA at once. Each virtual user (VU) opens the app, loads invoices, analytics and the activity log, checks `/api/health`, and 10 % of the time asks the AI agent a question. Then it pauses 1–3 s, like a person reading the screen.

**Always test a local server in mock mode.** Never point this at the real PayPal Sandbox or a real AI key: you would burn your quota, and PayPal would rate-limit your app.

## 1. Build and start NEXORA in load-test mode

```bash
npm run build
PAYPAL_MODE=mock AI_PROVIDER=mock NEXORA_ALLOW_MOCKS=true \
APP_PASSCODE=loadtest-pass DATABASE_PATH=./data/loadtest.db DEMO_AUTOSEED=true \
AI_MOCK_LATENCY_MS=2000 AI_MAX_CONCURRENCY=4 AI_MAX_RPM=14 \
npx next start -p 3300
```

- Mock PayPal and the scripted test AI (both labeled in the UI), on a separate database file.
- `AI_MOCK_LATENCY_MS=2000` makes each "model call" take 2 s, like a real one, so the AI gate is actually exercised.
- `AI_MAX_CONCURRENCY` / `AI_MAX_RPM` match the hosted demo, so you see how it behaves when AI demand exceeds the free-tier quota.

Check it's up: `curl http://localhost:3300/api/health` should print `"ok":true`.

## 2. Install k6

Ubuntu/Debian: `sudo snap install k6` (or see https://grafana.com/docs/k6/latest/set-up/install-k6/). Check with `k6 version`.

## 3. Run

In a second terminal:

```bash
k6 run -e NEXORA_URL=http://localhost:3300 -e NEXORA_PASSCODE=loadtest-pass -e VUS=300 loadtest/nexora-k6.js
```

| Option | Default | Meaning |
|---|---|---|
| `VUS` | 300 | Peak simultaneous virtual users |
| `HOLD` | `2m` | How long to hold the peak |
| `AI_SHARE` | 0.1 | Share of iterations that ask the AI agent |

## 4. Read the result

k6 prints a summary and marks each threshold ✓ or ✗:

| Threshold | Meaning |
|---|---|
| `unexpected_errors rate<0.01` | Under 1 % of requests got a real server error (5xx other than the deliberate "AI busy" 503) or no response |
| `http_req_duration{kind:read} p(95)<800` | 95 % of reads finished in under 800 ms |
| `checks{kind:ai} rate>0.99` | Every AI request got either an answer or a polite "try again in N seconds" |

`ai_answered` and `ai_shed_gracefully` show how many AI requests were served and how many were deferred by the per-workspace limiter or the AI gate. When AI demand exceeds the quota, deferrals are the expected, correct outcome. The point is that they're fast and readable, not errors.

After the run, `curl http://localhost:3300/api/health` shows the gate counters (`served`, `shed`), and the server should still answer normally.

## Notes

- k6 and the server share your laptop's CPU, so local numbers understate what a dedicated server does.
- One laptop can't generate 10,000 concurrent users. For that, use distributed k6 (k6 Cloud or several machines), and test a paid instance, not a free one.
- CI runs this test on every push (`.github/workflows/ci.yml`, job `loadtest`, 300 VUs by default; set the repo variable `LOADTEST_VUS` to change it).
