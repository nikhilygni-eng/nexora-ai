/**
 * NEXORA AI load test (k6).
 *
 * Simulates many signed-in people using the app at once: each virtual user (VU) loads the app,
 * reads invoices, analytics and the activity log, checks health, and a share of them asks the AI
 * agent a question. Run it against a LOCAL server in mock mode (see loadtest/README.md), never
 * against the real PayPal Sandbox or a real AI key.
 *
 *   k6 run -e NEXORA_URL=http://localhost:3300 -e NEXORA_PASSCODE=loadtest-pass -e VUS=500 loadtest/nexora-k6.js
 *
 * Pass/fail:
 *   - unexpected_errors < 1%   (5xx other than the deliberate "AI busy" 503, plus connection failures)
 *   - p95 read latency < 800 ms
 *   - every AI request gets a clean answer: 200, or 429/503 with a readable "try again" message
 */
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const BASE = (__ENV.NEXORA_URL || "http://localhost:3300").replace(/\/+$/, "");
const PASSCODE = __ENV.NEXORA_PASSCODE || "";
const PEAK = Number(__ENV.VUS || 300);
const HOLD = __ENV.HOLD || "2m";
const AI_SHARE = Number(__ENV.AI_SHARE || 0.1);

const unexpected = new Rate("unexpected_errors");
const aiAnswered = new Counter("ai_answered");
const aiShed = new Counter("ai_shed_gracefully");

export const options = {
  scenarios: {
    judges: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Math.max(1, Math.round(PEAK * 0.2)) },
        { duration: "1m", target: PEAK },
        { duration: HOLD, target: PEAK },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: {
    unexpected_errors: ["rate<0.01"],
    "http_req_duration{kind:read}": ["p(95)<800"],
    "checks{kind:ai}": ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// 429 (per-workspace limiter) and 503 (AI gate full) are deliberate, graceful answers, not failures.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429, 503));

export function setup() {
  if (!PASSCODE) throw new Error("Set -e NEXORA_PASSCODE=<the APP_PASSCODE of the server under test>");
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ passcode: PASSCODE }), { headers: { "Content-Type": "application/json" } });
  const cookie = res.cookies.nexora_session && res.cookies.nexora_session[0];
  if (res.status !== 200 || !cookie) throw new Error(`Login failed: HTTP ${res.status} ${res.body}`);
  return { session: cookie.value };
}

function record(res, kind) {
  const busy503 = res.status === 503 && String(res.body).includes("ai_busy");
  unexpected.add(res.status === 0 || (res.status >= 500 && !busy503), { kind });
}

function read(path, params) {
  const res = http.get(`${BASE}${path}`, Object.assign({ tags: { kind: "read", name: path.split("?")[0] } }, params));
  record(res, "read");
  check(res, { [`${path.split("?")[0]} is 200`]: (r) => r.status === 200 }, { kind: "read" });
  return res;
}

const QUESTIONS = ["How much is overdue right now?", "Who owes me the most?", "Summarize my receivables.", "List my open invoices."];

export default function (data) {
  const params = { headers: { Cookie: `nexora_session=${data.session}` } };

  group("open the app", () => {
    const page = http.get(`${BASE}/app`, Object.assign({ tags: { kind: "page", name: "/app" } }, params));
    record(page, "page");
    check(page, { "app page renders": (r) => r.status === 200 && String(r.body).includes("<html") }, { kind: "page" });
  });

  group("browse", () => {
    read("/api/health", {});
    read("/api/invoices", params);
    read("/api/analytics?includeDemo=true", params);
    read("/api/activity", params);
  });

  if (Math.random() < AI_SHARE) {
    group("ask the AI agent", () => {
      const q = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
      const res = http.post(
        `${BASE}/api/agent`,
        JSON.stringify({ conversationId: null, message: q }),
        Object.assign({ tags: { kind: "ai", name: "/api/agent" }, timeout: "120s" }, { headers: Object.assign({ "Content-Type": "application/json" }, params.headers) }),
      );
      record(res, "ai");
      let body = {};
      try {
        body = res.json();
      } catch (_) {
        body = {};
      }
      if (res.status === 200) aiAnswered.add(1);
      if (res.status === 429 || res.status === 503) aiShed.add(1);
      check(
        res,
        {
          "AI request answered or politely deferred": () =>
            (res.status === 200 && typeof body.reply === "string") ||
            ((res.status === 429 || res.status === 503) && body.error && /try again/i.test(body.error.message || "")),
        },
        { kind: "ai" },
      );
    });
  }

  sleep(1 + Math.random() * 2); // think time between screens
}
