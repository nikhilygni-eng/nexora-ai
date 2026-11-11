#!/usr/bin/env node
/**
 * READ-ONLY PayPal Sandbox credential check. Creates nothing, sends nothing, moves no money.
 *   1. OAuth2 client-credentials token from the Sandbox. PayPal decides whether the Client ID and
 *      Secret are a valid, matching pair from one Sandbox REST app.
 *   2. GET /v2/invoicing/invoices?page_size=1 (proves the app has Invoicing access)
 * Both requests time out after 20 s. Prints HTTP statuses and PayPal debug IDs; never prints
 * credentials or tokens.
 *
 * Exit code: 0 = ready, 1 = checked and not ready (rejected, unreachable, timed out, unexpected
 * answer), 2 = not configured.
 *
 *   npm run check:paypal
 */
import fs from "node:fs";
import { checkPayPal, printReport } from "./lib/key-checks.mjs";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const report = await checkPayPal({
  clientId: process.env.PAYPAL_CLIENT_ID,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET,
  baseUrl: process.env.PAYPAL_BASE_URL,
});
process.exit(printReport(report));
