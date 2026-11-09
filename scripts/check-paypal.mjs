#!/usr/bin/env node
/**
 * READ-ONLY PayPal Sandbox credential check. Creates nothing, sends nothing, moves no money.
 *   1. OAuth2 client-credentials token from the Sandbox
 *   2. GET /v2/invoicing/invoices?page_size=1 (proves the app has Invoicing access)
 * Prints HTTP status, PayPal debug IDs and scopes-related hints. Never prints credentials or tokens.
 *
 *   npm run check:paypal
 */
import fs from "node:fs";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const base = (process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com").replace(/\/+$/, "");
const id = process.env.PAYPAL_CLIENT_ID?.trim();
const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();

if (base !== "https://api-m.sandbox.paypal.com") {
  console.error(`Refusing: PAYPAL_BASE_URL is ${base}, not the Sandbox.`);
  process.exit(2);
}
if (!id || !secret) {
  console.error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set in .env.local.");
  console.error("Get them at developer.paypal.com → Apps & Credentials → Sandbox → (your app).");
  process.exit(2);
}

const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials",
});
const tokenJson = await tokenRes.json().catch(() => ({}));
console.log(`OAuth token: HTTP ${tokenRes.status} debug_id=${tokenRes.headers.get("paypal-debug-id") ?? "-"}`);
if (!tokenRes.ok || !tokenJson.access_token) {
  console.error(`  ${tokenJson.error ?? "error"}: ${tokenJson.error_description ?? "no description"}`);
  console.error("  → Check that the ID and secret are from the SANDBOX tab and copied without spaces.");
  process.exit(1);
}
const scopes = String(tokenJson.scope ?? "");
console.log(`  app_id=${tokenJson.app_id ?? "-"} expires_in=${tokenJson.expires_in}s`);
console.log(`  invoicing scope present: ${/invoicing/i.test(scopes) ? "yes" : "NOT FOUND in token scopes"}`);

const listRes = await fetch(`${base}/v2/invoicing/invoices?page=1&page_size=1&total_required=true`, {
  headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/json" },
});
const list = await listRes.json().catch(() => ({}));
console.log(`List invoices: HTTP ${listRes.status} debug_id=${listRes.headers.get("paypal-debug-id") ?? "-"}`);
if (!listRes.ok) {
  console.error(`  ${list.name ?? "error"}: ${list.message ?? ""}`);
  if (listRes.status === 403) console.error("  → Enable the Invoicing feature for this Sandbox app (App settings → Features).");
  process.exit(1);
}
console.log(`  total invoices on this sandbox account: ${list.total_items ?? "?"}`);
console.log("PayPal Sandbox credentials OK (read-only check; nothing was created).");
