#!/usr/bin/env node
/**
 * Prepares a MOCK-mode server for a load test: loads demo data and creates one mock-PayPal invoice
 * that stays open, so status polling has real work to do. Refuses to run against PAYPAL_MODE=sandbox.
 *
 *   node scripts/load-seed.mjs --url http://localhost:3311 --passcode <APP_PASSCODE>
 */
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const BASE = (args.url ?? "http://localhost:3000").replace(/\/+$/, "");
const PASSCODE = args.passcode ?? process.env.APP_PASSCODE;

async function call(method, path, body, cookie) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return { res, data };
}

const health = (await call("GET", "/api/health")).data;
if (health.paypalMode !== "mock") throw new Error("load-seed only runs against a server in PAYPAL_MODE=mock.");
const login = await call("POST", "/api/auth/login", { passcode: PASSCODE });
const cookie = login.res.headers.getSetCookie()[0].split(";")[0];
await call("POST", "/api/demo", { action: "seed" }, cookie);
const turn = (await call("POST", "/api/agent", { message: "Bill Acme Corp $800 for the landing page redesign, due in 14 days. ap@acme.example" }, cookie)).data;
const proposal = turn.proposals?.[0];
if (!proposal) throw new Error("agent did not draft an invoice: " + JSON.stringify(turn));
await call("POST", `/api/proposals/${proposal.id}/approve`, {}, cookie);
const inv = (await call("GET", "/api/invoices", undefined, cookie)).data.invoices;
console.log(`Seeded: ${inv.length} invoices (${inv.filter((i) => i.source !== "demo").length} mock-PayPal, open for status polling).`);
