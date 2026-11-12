import { expect, test, type Page } from "@playwright/test";
import { CURSOR_SCRIPT, Human } from "./human";
import { startDryRun, startRecording, type Recording } from "./screencast";

/**
 * Records the Devpost demo video: the full NEXORA loop in a real browser, driven like a person
 * would use it (see ./human.ts), with captions in a band below the app.
 *
 *   DEMO_MODE=sandbox → real PayPal Sandbox + real Gemini (needs PAYPAL_CLIENT_ID/SECRET, GEMINI_API_KEY,
 *                       SANDBOX_BUYER_EMAIL). This is the one to submit.
 *   DEMO_MODE=mock    → mock PayPal + scripted AI, for rehearsing the script. Captions say so; don't submit it.
 *
 * Everything plays at 1×. The script aims for about 2:50; when live responses run slow, later
 * reading pauses shorten (never below 2 s for key results) instead of speeding the video up.
 */
const MODE = process.env.DEMO_MODE === "sandbox" ? "sandbox" : "mock";
const PASSCODE = process.env.DEMO_PASSCODE ?? "demo-passcode";
const CLIENT_EMAIL = process.env.SANDBOX_BUYER_EMAIL || "ap@acme-corp.example";
const OUT = process.env.DEMO_OUT ?? "demo-output";
const real = MODE === "sandbox";
/** DEMO_CAPTURE=off rehearses the walkthrough with no video, screenshots or files. */
const CAPTURE = process.env.DEMO_CAPTURE !== "off";
/**
 * DEMO_APPROVE=off is the no-PayPal-mutation pass: real drafting, review and edit, then the proposal
 * is cancelled instead of approved. Nothing is created or sent in PayPal, and the run fails if the
 * audit log shows any PayPal call.
 */
const APPROVE = process.env.DEMO_APPROVE !== "off";
/** Live steps that didn't work. In sandbox mode any of these fails the run (the partial video is still encoded). */
const problems: string[] = [];

test.setTimeout(10 * 60_000);

/**
 * Evidence for the run log: which model, which PayPal invoice, which PayPal calls. IDs, links and
 * status codes only, never credentials. Log-only: it can't fail or interrupt the recording.
 */
async function note(label: string, read: () => Promise<string>) {
  try {
    console.log(`[demo] evidence | ${label}: ${await read()}`);
  } catch (e) {
    console.log(`[demo] evidence | ${label}: not available (${String((e as Error).message).slice(0, 120)})`);
  }
}

async function agentTurn(page: Page, me: Human, rec: Recording, label: string, text: string) {
  const composer = page.locator("#composer");
  const typingStarted = Date.now();
  await me.type(composer, text);
  const typingMs = Date.now() - typingStarted;
  await expect(composer).toHaveValue(text);
  await me.pause(650); // a beat before sending
  const done = page.waitForResponse((r) => r.url().endsWith("/api/agent") && r.request().method() === "POST", { timeout: 120_000 });
  const sent = Date.now();
  await page.keyboard.press("Enter");
  const res = await rec.segment("wait", () => done);
  const answeredMs = Date.now() - sent;
  const body = await res.text();
  expect(res.status(), `agent turn failed: ${body}`).toBe(200);
  await note(`AI turn "${label}"`, async () => {
    const j = JSON.parse(body) as { provider?: string; model?: string; trace?: { tool: string; ok: boolean }[]; proposals?: unknown[] };
    const wpm = Math.round(text.length / 5 / (typingMs / 60_000));
    return (
      `provider=${j.provider} model=${j.model} answered in ${(answeredMs / 1000).toFixed(1)} s | ` +
      `tools: ${(j.trace ?? []).map((t) => `${t.tool}:${t.ok ? "ok" : "asked-for-more"}`).join(", ") || "none"} | proposals: ${(j.proposals ?? []).length} | ` +
      `typed ${text.length} characters in ${(typingMs / 1000).toFixed(1)} s (${wpm} wpm including the click)`
    );
  });
  await me.pause(500);
}

test("record the NEXORA demo", async ({ page }) => {
  await page.addInitScript(CURSOR_SCRIPT);
  await page.goto("/");
  const rec = CAPTURE ? await startRecording(page, OUT) : startDryRun();
  const me = new Human(page);
  const t0 = Date.now();
  const elapsed = () => (Date.now() - t0) / 1000;
  let behind = false;
  /** Start of a scene: log the real time, and note whether we're running late against the plan. */
  const scene = (name: string, plannedStartSec: number) => {
    behind = elapsed() > plannedStartSec + 5;
    console.log(`[demo] ${elapsed().toFixed(1)}s (planned ${plannedStartSec}s)${behind ? " LATE" : ""}  ${name}`);
  };
  const say = (text: string) => rec.caption(text);
  /** Reading time. Key results always get at least 2 s. */
  const hold = (ms: number, key = false) => me.pause(Math.max(key ? 2000 : 700, behind ? ms * 0.6 : ms));

  try {
    // 1. Hook
    scene("landing", 0);
    await me.wake();
    await say("Invoicing and chasing payments eat a freelancer's week.");
    await hold(2800);
    await say("NEXORA AI turns one sentence into a real PayPal invoice. Nothing is sent without your approval.");
    await hold(3600, true);
    await rec.shot("01-landing");

    // 2. Sign in
    scene("sign in", 7);
    // The visitor's normal way in: the landing page's "Open workspace" button leads to sign-in.
    await me.click(page.getByRole("link", { name: "Open workspace" }));
    await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
    await expect(page.locator("#pc")).toBeVisible();
    // Let the page finish loading and become interactive before typing, like a person would.
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await me.wake();
    await say("Sign in to the workspace.");
    await me.type(page.locator("#pc"), PASSCODE);
    await expect(page.locator("#pc"), "passcode field didn't keep what was typed").toHaveValue(PASSCODE);
    await me.pause(450);
    const signedIn = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"), { timeout: 30_000 });
    await me.click(page.locator("button[type=submit]"));
    expect((await signedIn).status(), "sign-in request failed").toBe(200);
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/app$/);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await me.wake();
    await say(real ? "Connected to the real PayPal Sandbox and Google Gemini." : "REHEARSAL: mock PayPal + scripted test AI (labeled in the UI).");
    await note("configuration", async () => {
      const j = (await (await page.request.get("/api/setup")).json()) as Record<string, unknown>;
      return `PayPal mode=${j.paypalMode} sandbox=${j.sandbox} ready=${j.paypalReady} | AI provider=${j.aiProvider} model=${j.aiModel} ready=${j.aiReady}`;
    });
    await hold(2200);

    // 3. Plain-English request → the agent asks instead of guessing
    scene("describe the job", 18);
    await say("Describe the job in plain English.");
    await agentTurn(page, me, rec, "describe the job", "Bill Acme Corp $800 for the landing page redesign, due in 14 days.");
    await say("It doesn't know Acme's email, so it asks. NEXORA never guesses an address.");
    await hold(3400, true);
    await rec.shot("02-asks-for-email");

    // 4. Answer → invoice proposal
    scene("client email", 42);
    await say("Give it the client's email.");
    await agentTurn(page, me, rec, "client email", CLIENT_EMAIL);
    const approve = page.getByRole("button", { name: "Approve & send via PayPal" });
    await expect(approve).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(CLIENT_EMAIL).last()).toBeVisible();
    await me.reveal(approve);
    await say("An invoice proposal to review. Nothing has reached PayPal yet.");
    await hold(3400, true);
    await rec.shot("03-invoice-slip");

    // 5. Edit: add tax; totals recompute on the server
    scene("edit tax", 60);
    await me.click(page.getByRole("button", { name: "Edit" }));
    await say("Anything can be edited. Add 18% GST.");
    await me.replace(page.getByLabel("Tax name"), "GST");
    await expect(page.getByLabel("Tax name")).toHaveValue("GST");
    await me.pause(350);
    await me.replace(page.getByLabel("Tax %"), "18");
    await expect(page.getByLabel("Tax %")).toHaveValue("18");
    await me.pause(500);
    await me.click(page.getByRole("button", { name: "Save changes" }));
    await expect(page.getByText("$944.00").first()).toBeVisible({ timeout: 15_000 });
    await me.reveal(approve);
    await say("The server recalculates: $800 + 18% GST = $944.00.");
    await hold(3200, true);

    if (APPROVE) {
      // 6. Approve → PayPal
      scene("approve", 77);
      await say("Only my click sends it.");
      await me.click(approve, { dwellMs: 900 });
      await rec.segment("wait", () => expect(page.getByText("Invoice sent")).toBeVisible({ timeout: 90_000 }));
      await expect(approve).toHaveCount(0);
      await me.reveal(page.getByRole("link", { name: "Track payment" }));
      await say(real ? "PayPal created and sent the invoice. INV2… is PayPal's own invoice ID." : "REHEARSAL: the mock PayPal created and sent the invoice.");
      await hold(3600, true);
      await rec.shot("04-sent-via-paypal");

      // 7. Track payment: status straight from PayPal
      scene("track payment", 89);
      await me.click(page.getByRole("link", { name: "Track payment" }));
      const refresh = page.getByRole("button", { name: /Refresh status from PayPal/ });
      await expect(refresh).toBeVisible();
      await expect(page).toHaveURL(/\/app\/invoices\/[^/]+$/);
      await say("Status comes straight from PayPal.");
      await hold(1400);
      await rec.segment("optional", async () => {
        const synced = page.waitForResponse((r) => r.url().endsWith("/sync") && r.request().method() === "POST", { timeout: 60_000 });
        await me.click(refresh);
        expect((await synced).status(), "status refresh failed").toBe(200);
        await me.pause(1800);
      });
      const invoiceId = new URL(page.url()).pathname.split("/").pop() ?? "";
      const invoiceEvidence = () =>
        note("invoice", async () => {
          const j = (await (await page.request.get(`/api/invoices/${invoiceId}`)).json()) as { invoice?: Record<string, unknown> };
          const i = j.invoice ?? {};
          return (
            `PayPal ID ${i.paypal_invoice_id ?? "-"} | number ${i.invoice_number ?? "-"} | source ${i.source} | NEXORA status ${i.status} | ` +
            `PayPal status ${i.paypal_status ?? "-"} | total ${i.total_minor} minor units ${i.currency} | payer link ${i.recipient_view_url ?? "none"}`
          );
        });
      await invoiceEvidence();
      await rec.shot("05-invoice-detail");

      if (real) {
        scene("PayPal payer page", 97);
        const payer = page.getByRole("link", { name: /Open payer view in PayPal Sandbox/ });
        const href = await payer.getAttribute("href");
        if (!href) problems.push("No PayPal payer-view link on the invoice");
        if (href) {
          const back = page.url();
          // Recording only: follow the link in this tab (it normally opens a new one) so the click is visible.
          await payer.evaluate((el) => el.removeAttribute("target"));
          await say("This is what the client receives from PayPal.");
          await me.click(payer, { dwellMs: 700 });
          try {
            await page.waitForURL((u) => !u.hostname.includes("localhost"), { timeout: 30_000, waitUntil: "domcontentloaded" });
          } catch {
            await page.goto(href, { waitUntil: "domcontentloaded" });
          }
          await rec.restart();
          await me.wake();
          await rec.segment("wait", () => me.pause(3000)); // let PayPal's page finish drawing
          await say("PayPal's own invoice page: the client pays by PayPal or card.");
          await note("PayPal payer page", async () => `host ${new URL(page.url()).host} | title "${await page.title()}"`);
          await hold(3800, true);
          await rec.shot("06-paypal-payer-view");
          await page.goto(back);
          await page.waitForLoadState("networkidle").catch(() => undefined);
          await rec.restart();
          await expect(refresh).toBeVisible();
          await me.wake();
        }
      }

      // 8. AI reminder, approval-gated
      scene("reminder", 112);
      await me.click(page.getByRole("button", { name: "Draft reminder with AI" }));
      await say("For a late payer, the AI drafts a polite reminder…");
      const sendReminder = page.getByRole("button", { name: "Approve & send reminder" });
      await rec.segment("wait", () => expect(sendReminder).toBeVisible({ timeout: 90_000 }));
      await me.reveal(sendReminder);
      await say("…and PayPal sends it only after I approve.");
      await hold(3000, true);
      await rec.shot("07-reminder-draft");
      await me.click(sendReminder, { dwellMs: 600 });
      await rec.segment("wait", () => expect(page.getByText("PayPal sent the reminder")).toBeVisible({ timeout: 90_000 }));
      await invoiceEvidence();
      await hold(2000);

      if (!real) {
        await me.click(page.getByRole("button", { name: "Simulate payment (mock only)" }));
        await expect(page.getByText("PAID", { exact: true })).toBeVisible();
        await say("REHEARSAL: simulated payment, synced back as Paid.");
        await hold(2200);
      }
    } else {
      // 6'. No-PayPal pass: cancel instead of approving.
      scene("cancel instead of approving", 77);
      await say("Nothing reaches PayPal unless I approve. This time I cancel the proposal instead.");
      await me.click(page.getByRole("button", { name: "Cancel", exact: true }), { dwellMs: 800 });
      await expect(page.getByText("Proposal cancelled")).toBeVisible({ timeout: 15_000 });
      await expect(approve).toHaveCount(0);
      await hold(3000, true);
      await rec.shot("04-proposal-cancelled");
    }

    // 9. Analytics + grounded AI insights
    scene("analytics", 127);
    await me.click(page.getByRole("link", { name: "Analytics" }).first());
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/analytics$/);
    await expect(page.locator(".ag-root")).toBeVisible({ timeout: 30_000 });
    await say("Analytics from my invoices. Sample rows are labeled Demo data.");
    await hold(3400, true);
    await rec.shot("08-analytics");
    const explain = page.getByRole("button", { name: "Explain my receivables" });
    await me.reveal(explain);
    const insights = page.waitForResponse((r) => r.url().endsWith("/api/insights"), { timeout: 120_000 });
    await me.click(explain);
    await say("The AI explains my receivables…");
    const insightsRes = await rec.segment("wait", () => insights);
    if (insightsRes.status() !== 200) problems.push(`AI insights returned HTTP ${insightsRes.status()}: ${(await insightsRes.text()).slice(0, 300)}`);
    else if (!(((await insightsRes.json()) as { insights?: unknown[] }).insights ?? []).length) problems.push("AI insights returned no verified insight");
    await note("AI insights", async () => {
      const j = (await insightsRes.json()) as { model?: string; insights?: { kind: string; grounded?: unknown[] }[]; dropped?: number; cached?: boolean };
      const list = j.insights ?? [];
      return `HTTP ${insightsRes.status()} | model=${j.model} | kept ${list.length} (${list.map((x) => `${x.kind}, ${(x.grounded ?? []).length} cited figure(s)`).join("; ")}) | discarded ${j.dropped ?? 0} | cached=${j.cached}`;
    });
    await me.pause(700);
    const basedOn = page.getByText(/Based on \d+ figure/).first();
    if (await basedOn.isVisible().catch(() => false)) await me.reveal(basedOn);
    await say("…and each insight cites the exact figures it used.");
    await hold(4000, true);
    await rec.shot("09-ai-insights");

    // 10. AG Grid
    scene("grid", 147);
    const search = page.locator("#grid-q");
    await me.reveal(search);
    await say("Every invoice in AG Grid: search, sort and filter.");
    const rowWith = (text: string) => page.locator(".ag-root [role=row]", { hasText: text });
    await me.type(search, "Lumen");
    await expect(search).toHaveValue("Lumen");
    await expect(rowWith("Lumen").first()).toBeVisible();
    await expect(rowWith("Northwind")).toHaveCount(0); // the filter really narrowed the grid
    await hold(1800);
    await me.replace(search, "");
    await expect(search).toHaveValue("");
    await me.pause(500);
    const outstanding = page.locator(".ag-header-cell", { hasText: "Outstanding" });
    await me.click(outstanding);
    await expect(outstanding).toHaveAttribute("aria-sort", /ascending|descending/);
    await hold(2000);
    await rec.shot("10-ag-grid");

    // 11. Audit trail and close
    scene("activity log", 160);
    await me.click(page.getByRole("link", { name: "Activity log" }).first());
    await expect(page.getByText(APPROVE ? "PayPal created the draft invoice" : "You cancelled the proposal").first()).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/app\/activity$/);
    await say(APPROVE ? "Every AI proposal, approval and PayPal call is logged with PayPal's debug ID." : "Every AI proposal and every decision is logged. Nothing was sent to PayPal.");
    let paypalCalls = -1;
    await note("PayPal calls in the audit log, oldest first", async () => {
      const j = (await (await page.request.get("/api/activity")).json()) as { entries?: { paypal_endpoint: string | null; http_status: number | null; debug_id: string | null }[] };
      const calls = (j.entries ?? []).filter((e) => e.paypal_endpoint).reverse();
      paypalCalls = calls.length;
      return `${calls.length} call(s): ` + calls.slice(0, 40).map((e) => `${e.paypal_endpoint} → ${e.http_status}${e.debug_id ? ` [debug ${e.debug_id}]` : ""}`).join(" ; ");
    });
    if (!APPROVE && paypalCalls !== 0) problems.push(`The no-PayPal pass must make zero PayPal calls, but the audit log shows ${paypalCalls < 0 ? "an unreadable count" : paypalCalls}`);
    await hold(3600, true);
    await rec.shot("11-activity-log");
    await say("NEXORA AI: say who owes you, approve, and PayPal does the rest.");
    await hold(3000);
    scene("end", 172);
  } catch (e) {
    // Where were we? (URL and visible headings only; never page data.)
    const headings = await page.locator("h1, h2").allTextContents().catch(() => []);
    console.error(`[demo] FAILED at ${elapsed().toFixed(1)}s on ${page.url()} | headings: ${headings.slice(0, 5).join(" / ")}`);
    throw e;
  } finally {
    // Always write frames.json, so a failed run still produces a partial video to inspect.
    const r = await rec.stop();
    console.log(`[demo] mode=${MODE} approve=${APPROVE ? "on" : "off (no PayPal mutation)"} capture=${CAPTURE ? "on" : "off (rehearsal, no video)"} frames=${r.frames} ~${r.seconds}s`);
  }
  if (problems.length) {
    console.warn(`[demo] live-step problems:\n- ${problems.join("\n- ")}`);
    if (real) throw new Error(`Recording is not submission-ready: ${problems.join("; ")}`);
  }
});
