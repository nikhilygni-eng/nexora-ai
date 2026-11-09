#!/usr/bin/env node
/**
 * Drives the real UI in Chromium against a RUNNING server with a REAL AI provider and saves
 * screenshots. Approve is clicked only to verify error handling when PayPal is not configured
 * (it never reaches PayPal in that case) or, with Sandbox credentials, to create a Sandbox invoice.
 *
 *   NEXORA_URL=http://localhost:3300 NEXORA_PASSCODE=... node scripts/ui-live-smoke.mjs [outDir]
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.NEXORA_URL ?? "http://localhost:3300";
const PASS = process.env.NEXORA_PASSCODE;
const OUT = process.argv[2] ?? "test-results/ui-live";
if (!PASS) throw new Error("Set NEXORA_PASSCODE");
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(...a);
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push("console: " + m.text()));

  await page.goto(BASE + "/login");
  await page.fill("#pc", PASS);
  await page.click("button[type=submit]");
  await page.waitForURL("**/app");
  const setup = await (await page.request.get(BASE + "/api/setup")).json();
  log(`AI ${setup.aiProvider}/${setup.aiModel} · PayPal ${setup.paypalMode} ready=${setup.paypalReady}`);

  const send = async (text) => {
    const before = await page.locator("main p.whitespace-pre-wrap").count();
    await page.fill("#composer", text);
    const t0 = Date.now();
    await page.keyboard.press("Enter");
    await page.waitForFunction((n) => document.querySelectorAll("main p.whitespace-pre-wrap").length >= n + 2, before, { timeout: 90000 });
    await page.waitForSelector("text=Working on it…", { state: "detached", timeout: 90000 });
    const reply = (await page.locator("main p.whitespace-pre-wrap").last().textContent())?.trim();
    log(`  "${text.slice(0, 60)}…" → ${Date.now() - t0} ms\n    reply: ${reply}`);
    return reply;
  };

  log("1. hero request");
  await send("Bill Acme Corp $800 for the landing page redesign, due in 14 days.");
  await page.screenshot({ path: `${OUT}/1-clarify.png`, fullPage: true });

  log("2. answer with email");
  await send("ap@acme-corp.example");
  await page.waitForSelector("text=Approve & send via PayPal", { timeout: 30000 });
  await page.screenshot({ path: `${OUT}/2-proposal.png`, fullPage: true });

  log("3. approve");
  await page.click("text=Approve & send via PayPal");
  await page.locator('[role="alert"]').filter({ hasText: /PayPal/ }).or(page.getByText("Invoice sent")).first().waitFor({ timeout: 60000 });
  const alert = await page.locator('[role="alert"]').filter({ hasText: /PayPal/ }).first().textContent().catch(() => null);
  log(alert ? `    approval result: ERROR shown → ${alert.trim()}` : "    approval result: invoice sent");
  await page.screenshot({ path: `${OUT}/3-after-approve.png`, fullPage: true });

  const activity = await (await page.request.get(BASE + "/api/activity")).json();
  const ppCalls = activity.entries.filter((e) => e.paypal_endpoint);
  log(`    PayPal calls in audit log: ${ppCalls.length}${ppCalls.map((c) => `\n      ${c.paypal_endpoint} → ${c.http_status ?? "-"} debug_id=${c.debug_id ?? "-"}`).join("")}`);

  log("4. analytics + insights");
  await page.goto(BASE + "/app/analytics");
  await page.waitForSelector(".ag-root", { timeout: 30000 });
  await page.click("text=Explain my receivables");
  await page.waitForSelector("text=Based on", { timeout: 90000 }).catch(() => undefined);
  await page.screenshot({ path: `${OUT}/4-analytics.png`, fullPage: true });

  log("5. mobile command center");
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await m.context().addCookies(await page.context().cookies());
  await m.goto(BASE + "/app");
  await m.waitForSelector("#composer");
  await m.waitForTimeout(800);
  await m.screenshot({ path: `${OUT}/5-mobile.png`, fullPage: true });
} finally {
  await browser.close();
}
log(errors.length ? `Browser errors:\n  ${errors.join("\n  ")}` : "No browser errors.");
log(`Screenshots: ${OUT}`);
