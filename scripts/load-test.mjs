#!/usr/bin/env node
/**
 * Zero-dependency load test for NEXORA AI.
 *
 * Simulates N concurrent signed-in users hammering the dashboard (invoices, analytics, activity,
 * PayPal status polling) and reports whether the server stayed up, how many requests succeeded,
 * how many were gracefully shed (503 busy / 429), and how many failed.
 *
 *   node scripts/load-test.mjs --url http://localhost:3311 --passcode <APP_PASSCODE> --users 10000 --duration 60
 *
 * Options: --users (default 1000) --duration s (steady state, default 30) --ramp s (default 10)
 *          --think ms (max random pause between a user's requests, default 1000)
 *          --mix dashboard|ai (ai adds POST /api/agent; refused unless the server runs mock PayPal + mock AI)
 *          --out results.json
 *
 * Never point --mix ai at a server using real Gemini or the real PayPal Sandbox: it would spend quota.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]]] : acc), []),
);
const num = (v, d) => (v === undefined || Number.isNaN(Number(v)) ? d : Number(v));
const BASE = new URL(args.url ?? "http://localhost:3000");
const USERS = num(args.users, 1000);
const DURATION_MS = num(args.duration, 30) * 1000;
const RAMP_MS = num(args.ramp, 10) * 1000;
const THINK_MS = num(args.think, 1000);
const TIMEOUT_MS = num(args.timeout, 30) * 1000;
const MIX_NAME = args.mix ?? "dashboard";
const PASSCODE = args.passcode ?? process.env.APP_PASSCODE;

const lib = BASE.protocol === "https:" ? https : http;
const agent = new lib.Agent({ keepAlive: true, maxSockets: USERS + 16 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, path, { body, cookie } = {}) {
  return new Promise((resolve) => {
    const started = performance.now();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = lib.request(
      new URL(path, BASE),
      {
        method,
        agent,
        timeout: TIMEOUT_MS,
        headers: {
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          ...(cookie ? { cookie } : {}),
        },
      },
      (res) => {
        const keep = (res.statusCode ?? 0) >= 400 || path.startsWith("/api/health") || path.startsWith("/api/auth");
        const chunks = [];
        res.on("data", (c) => keep && chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, ms: performance.now() - started, headers: res.headers, body: keep ? Buffer.concat(chunks).toString() : "" }),
        );
        res.on("error", (e) => resolve({ status: 0, ms: performance.now() - started, error: e.code ?? e.message }));
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
    req.on("error", (e) => resolve({ status: 0, ms: performance.now() - started, error: e.code ?? e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

const DASHBOARD = [
  [35, "GET", "/api/invoices"],
  [30, "GET", "/api/analytics?includeDemo=true"],
  [15, "GET", "/api/activity"],
  [10, "GET", "/api/health"],
  [10, "POST", "/api/invoices/sync", {}],
];
const MIXES = {
  dashboard: DASHBOARD,
  ai: [...DASHBOARD.map(([w, ...r]) => [w * 0.8, ...r]), [20, "POST", "/api/agent", { message: "Bill Acme Corp $800 for the landing page redesign. ap@acme.com" }]],
};
const MIX = MIXES[MIX_NAME];
if (!MIX) throw new Error(`Unknown --mix ${MIX_NAME}`);
const TOTAL_WEIGHT = MIX.reduce((s, [w]) => s + w, 0);
function pick() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const m of MIX) if ((r -= m[0]) <= 0) return m;
  return MIX[MIX.length - 1];
}

const stats = { ok: 0, shed: 0, error: 0, byStatus: {}, errors: {}, byRoute: {}, latOk: [], latAll: [] };
let window = { ok: 0, shed: 0, error: 0 };
function classify(r) {
  if (r.status >= 200 && r.status < 300) return "ok";
  if (r.status === 429 || (r.status === 503 && /"busy"/.test(r.body))) return "shed";
  return "error";
}
function record(route, r) {
  const kind = classify(r);
  stats[kind]++;
  window[kind]++;
  const key = r.status ? String(r.status) : `network:${r.error}`;
  stats.byStatus[key] = (stats.byStatus[key] ?? 0) + 1;
  if (kind === "error") {
    const why = r.error ?? (r.body?.match(/"code":"([^"]+)"/)?.[1] ?? `http_${r.status}`);
    stats.errors[why] = (stats.errors[why] ?? 0) + 1;
  }
  const rs = (stats.byRoute[route] ??= { ok: 0, shed: 0, error: 0 });
  rs[kind]++;
  stats.latAll.push(r.ms);
  if (kind === "ok") stats.latOk.push(r.ms);
}
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = Float64Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function health() {
  const r = await request("GET", "/api/health");
  try {
    return { status: r.status, ...JSON.parse(r.body || "{}"), ms: r.ms, error: r.error };
  } catch {
    return { status: r.status, ms: r.ms, error: r.error };
  }
}

async function main() {
  if (!PASSCODE) throw new Error("Pass --passcode or set APP_PASSCODE (the app's sign-in passcode).");
  const h0 = await health();
  if (h0.status !== 200) throw new Error(`Server not healthy before the test: ${JSON.stringify(h0)}`);
  if (MIX_NAME === "ai" && h0.paypalMode !== "mock") {
    throw new Error("--mix ai only runs against a server in PAYPAL_MODE=mock with AI_PROVIDER=mock (it would spend real quota).");
  }
  const login = await request("POST", "/api/auth/login", { body: { passcode: PASSCODE } });
  const setCookie = [].concat(login.headers?.["set-cookie"] ?? [])[0];
  if (login.status !== 200 || !setCookie) throw new Error(`Login failed (${login.status}): ${login.body}`);
  const cookie = setCookie.split(";")[0];

  console.log(`NEXORA load test → ${BASE.origin}`);
  console.log(`${USERS} users · ramp ${RAMP_MS / 1000}s · steady ${DURATION_MS / 1000}s · think ≤${THINK_MS}ms · mix ${MIX_NAME} · PayPal mode ${h0.paypalMode}\n`);

  const t0 = performance.now();
  const endAt = t0 + RAMP_MS + DURATION_MS;
  let active = 0;
  let peakActive = 0;
  let maxLag = 0;
  const monitor = setInterval(async () => {
    const elapsed = ((performance.now() - t0) / 1000).toFixed(0);
    const w = window;
    window = { ok: 0, shed: 0, error: 0 };
    const h = await health();
    maxLag = Math.max(maxLag, h.lagMs ?? 0);
    console.log(
      `t=${elapsed.padStart(4)}s users=${String(active).padStart(6)} rps=${String(Math.round((w.ok + w.shed + w.error) / 5)).padStart(6)} ` +
        `ok=${w.ok} shed=${w.shed} err=${w.error} · health ${h.status || h.error} lag=${h.lagMs ?? "?"}ms (${Math.round(h.ms)}ms)`,
    );
  }, 5000);

  const user = async (i) => {
    await sleep((RAMP_MS * i) / USERS);
    active++;
    peakActive = Math.max(peakActive, active);
    while (performance.now() < endAt) {
      const [, method, path, body] = pick();
      record(`${method} ${path.split("?")[0]}`, await request(method, path, { body, cookie }));
      if (THINK_MS) await sleep(Math.random() * THINK_MS);
    }
    active--;
  };
  await Promise.all(Array.from({ length: USERS }, (_, i) => user(i)));
  clearInterval(monitor);
  const seconds = (performance.now() - t0) / 1000;

  let after = await health();
  for (let i = 0; i < 3 && after.status !== 200; i++) {
    await sleep(2000);
    after = await health();
  }
  const total = stats.ok + stats.shed + stats.error;
  const summary = {
    target: BASE.origin,
    users: USERS,
    peak_concurrent_users: peakActive,
    seconds: Math.round(seconds),
    requests: total,
    avg_rps: Math.round(total / seconds),
    ok: stats.ok,
    shed_gracefully: stats.shed,
    errors: stats.error,
    error_rate_pct: total ? +((100 * stats.error) / total).toFixed(3) : 0,
    latency_ms_ok: { p50: Math.round(pct(stats.latOk, 50)), p95: Math.round(pct(stats.latOk, 95)), p99: Math.round(pct(stats.latOk, 99)) },
    latency_ms_all: { p50: Math.round(pct(stats.latAll, 50)), p95: Math.round(pct(stats.latAll, 95)), p99: Math.round(pct(stats.latAll, 99)) },
    max_event_loop_lag_ms: maxLag,
    by_status: stats.byStatus,
    error_reasons: stats.errors,
    by_route: stats.byRoute,
    server_up_after_test: after.status === 200,
    health_after: after,
  };
  console.log("\n" + JSON.stringify(summary, null, 2));
  console.log(
    `\nVerdict: server ${summary.server_up_after_test ? "STAYED UP" : "WENT DOWN"} · ${summary.ok} ok · ${summary.shed_gracefully} shed (503 busy / 429) · ${summary.errors} errors (${summary.error_rate_pct}%)`,
  );
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(summary, null, 2));
  agent.destroy();
  process.exitCode = summary.server_up_after_test && summary.error_rate_pct < 1 ? 0 : 1;
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
