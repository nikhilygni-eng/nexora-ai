/**
 * k6 load test for a hosted NEXORA AI deployment (https://k6.io).
 *
 *   k6 run -e BASE_URL=https://<your-app>.onrender.com -e PASSCODE=<APP_PASSCODE> -e USERS=10000 load/k6-dashboard.js
 *
 * Dashboard traffic only (invoices, analytics, activity, health). It does NOT call the AI agent or
 * approve invoices, so it never spends Gemini quota or writes to the PayPal Sandbox.
 * 503 "busy" and 429 count as expected: that is the server shedding load on purpose, not failing.
 */
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const USERS = Number(__ENV.USERS || 10000);

export const options = {
  scenarios: {
    dashboard: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || "60s", target: USERS },
        { duration: __ENV.HOLD || "2m", target: USERS },
        { duration: "20s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"], // real failures (5xx other than busy, timeouts, refused) under 1%
    "http_req_duration{expected_response:true}": ["p(95)<2000"],
    checks: ["rate>0.99"],
  },
};

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 429, 503));

export function setup() {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ passcode: __ENV.PASSCODE }), {
    headers: { "Content-Type": "application/json" },
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.body}`);
  const session = res.cookies.nexora_session && res.cookies.nexora_session[0];
  if (!session) throw new Error("no session cookie");
  return { cookie: `nexora_session=${session.value}` };
}

const ROUTES = [
  [35, "/api/invoices"],
  [30, "/api/analytics?includeDemo=true"],
  [20, "/api/activity"],
  [15, "/api/health"],
];

export default function dashboardUser(data) {
  let r = Math.random() * 100;
  let path = ROUTES[0][1];
  for (const [w, p] of ROUTES) {
    if ((r -= w) <= 0) {
      path = p;
      break;
    }
  }
  const res = http.get(`${BASE}${path}`, { headers: { Cookie: data.cookie }, tags: { route: path.split("?")[0] } });
  check(res, {
    "served or shed on purpose": (x) =>
      (x.status >= 200 && x.status < 300) || x.status === 429 || (x.status === 503 && String(x.body).includes('"busy"')),
  });
  sleep(Math.random());
}
