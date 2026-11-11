import { expect, test, type Page } from "@playwright/test";
import { OVERLAY_SCRIPT, startRecording } from "./screencast";

/**
 * Records the Devpost demo video: the full NEXORA loop in a real browser, with captions.
 *
 *   DEMO_MODE=sandbox → real PayPal Sandbox + real Gemini (needs PAYPAL_CLIENT_ID/SECRET, GEMINI_API_KEY,
 *                       SANDBOX_BUYER_EMAIL). This is the one to submit.
 *   DEMO_MODE=mock    → mock PayPal + scripted AI, for rehearsing the script. Captions say so; don't submit it.
 *
 * Run: npm run demo:record   (see .github/workflows/demo-video.yml)
 */
const MODE = process.env.DEMO_MODE === "sandbox" ? "sandbox" : "mock";
const PASSCODE = process.env.DEMO_PASSCODE ?? "demo-passcode";
const CLIENT_EMAIL = process.env.SANDBOX_BUYER_EMAIL || "ap@acme-corp.example";
const OUT = process.env.DEMO_OUT ?? "demo-output";
const real = MODE === "sandbox";
/** Live steps that didn't work. In sandbox mode any of these fails the run (the partial video is still encoded). */
const problems: string[] = [];

test.setTimeout(10 * 60_000);

async function agentTurn(page: Page, text: string) {
  const composer = page.locator("#composer");
  await composer.click();
  await composer.pressSequentially(text, { delay: 26 });
  const done = page.waitForResponse((r) => r.url().endsWith("/api/agent") && r.request().method() === "POST", { timeout: 120_000 });
  await page.keyboard.press("Enter");
  const res = await done;
  expect(res.status(), `agent turn failed: ${await res.text()}`).toBe(200);
  await page.waitForTimeout(700);
}

test("record the NEXORA demo", async ({ page }) => {
  await page.addInitScript(OVERLAY_SCRIPT);
  await page.goto("/");
  const rec = await startRecording(page, OUT);
  const say = async (text: string, holdMs = 3000) => {
    await rec.caption(text);
    if (holdMs) await page.waitForTimeout(holdMs);
  };
  await page.mouse.move(960, 540);
  try {
    // 1. Hook
    await say("Freelancers lose hours to invoicing and chasing late payments.", 3200);
    await say("NEXORA AI turns one sentence into a real PayPal invoice, and never sends anything without your approval.", 4200);
    await rec.shot("01-landing");

    // 2. Sign in
    await page.goto("/login");
    await say("", 0);
    await page.locator("#pc").click();
    await page.locator("#pc").pressSequentially(PASSCODE, { delay: 45 });
    await page.click("button[type=submit]");
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
    await say(real ? "Connected to the real PayPal Sandbox and Google Gemini." : "REHEARSAL: mock PayPal + scripted test AI (labeled in the UI).", 2600);

    // 3. Plain-English request → the agent asks instead of guessing
    await say("I just say who to bill, in plain English.", 0);
    await agentTurn(page, "Bill Acme Corp $800 for the landing page redesign, due in 14 days.");
    await say("The agent pulled out the client, amount and due date, but it doesn't know Acme's email. So it asks.", 4200);
    await say("NEXORA never guesses an email: the server rejects any address I didn't give it.", 3600);
    await rec.shot("02-asks-for-email");

    // 4. Answer → invoice slip
    await say("I give it the client's email.", 0);
    await agentTurn(page, CLIENT_EMAIL);
    const approve = page.getByRole("button", { name: "Approve & send via PayPal" });
    await expect(approve).toBeVisible({ timeout: 60_000 });
    await approve.scrollIntoViewIfNeeded();
    await say("Here's the invoice slip for review. Nothing has touched PayPal yet.", 3600);
    await rec.shot("03-invoice-slip");

    // 5. Edit: add tax; totals recompute on the server
    await page.getByRole("button", { name: "Edit" }).click();
    await say("I can edit anything. Let's add 18% GST.", 0);
    await page.getByLabel("Tax name").fill("");
    await page.getByLabel("Tax name").pressSequentially("GST", { delay: 60 });
    await page.getByLabel("Tax %").fill("");
    await page.getByLabel("Tax %").pressSequentially("18", { delay: 90 });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("$944.00").first()).toBeVisible({ timeout: 15_000 });
    await say("Totals are recomputed on the server in exact minor units: $800 + 18% = $944.00.", 3400);

    // 6. Approve → PayPal
    await approve.scrollIntoViewIfNeeded();
    await approve.hover();
    await say("Only my click sends it.", 1500);
    await approve.click();
    await expect(page.getByText("Invoice sent")).toBeVisible({ timeout: 90_000 });
    await say(
      real
        ? "The server created and sent the invoice with the PayPal Invoicing API. That INV2 number is PayPal's own invoice ID."
        : "REHEARSAL: the mock PayPal created and sent the invoice.",
      4400,
    );
    await rec.shot("04-sent-via-paypal");

    // 7. Track payment: status straight from PayPal
    await page.getByRole("link", { name: "Track payment" }).click();
    const refresh = page.getByRole("button", { name: /Refresh status from PayPal/ });
    await expect(refresh).toBeVisible();
    await say("Each invoice tracks its real status from PayPal.", 0);
    await refresh.click();
    await page.waitForTimeout(2600);
    await rec.shot("05-invoice-detail");

    if (real) {
      const payer = page.getByRole("link", { name: /Open payer view in PayPal Sandbox/ });
      const href = await payer.getAttribute("href");
      if (!href) problems.push("No PayPal payer-view link on the invoice");
      if (href) {
        const back = page.url();
        await payer.hover();
        await say("This is what the client receives from PayPal.", 1200);
        await page.goto(href, { waitUntil: "domcontentloaded" });
        await rec.restart();
        await page.waitForTimeout(3500);
        await say("The client's PayPal Sandbox invoice: pay by PayPal or card, straight to the freelancer.", 4500);
        await rec.shot("06-paypal-payer-view");
        await page.goto(back);
        await rec.restart();
        await expect(refresh).toBeVisible();
      }
    }

    // 8. AI reminder, approval-gated
    await page.getByRole("button", { name: "Draft reminder with AI" }).click();
    await say("If the client is late, the AI drafts a polite reminder…", 0);
    const sendReminder = page.getByRole("button", { name: "Approve & send reminder" });
    await expect(sendReminder).toBeVisible({ timeout: 90_000 });
    await sendReminder.scrollIntoViewIfNeeded();
    await say("…and PayPal sends it only after I approve.", 3200);
    await rec.shot("07-reminder-draft");
    await sendReminder.click();
    await expect(page.getByText("PayPal sent the reminder")).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(1600);

    if (!real) {
      await page.getByRole("button", { name: "Simulate payment (mock only)" }).click();
      await expect(page.getByText("PAID", { exact: true })).toBeVisible();
      await say("REHEARSAL: simulated payment, synced back as Paid.", 2400);
    }

    // 9. Analytics + grounded AI insights + AG Grid
    await page.getByRole("link", { name: "Analytics" }).first().click();
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    await expect(page.locator(".ag-root")).toBeVisible({ timeout: 30_000 });
    await say("Analytics: outstanding, overdue, aging and days-to-pay. Sample rows are clearly labeled Demo data.", 4400);
    await rec.shot("08-analytics");
    const explain = page.getByRole("button", { name: "Explain my receivables" });
    await explain.scrollIntoViewIfNeeded();
    const insights = page.waitForResponse((r) => r.url().endsWith("/api/insights"), { timeout: 120_000 });
    await explain.click();
    await say("The AI explains my receivables…", 0);
    const insightsRes = await insights;
    if (insightsRes.status() !== 200) problems.push(`AI insights returned HTTP ${insightsRes.status()}: ${(await insightsRes.text()).slice(0, 300)}`);
    else if (!(((await insightsRes.json()) as { insights?: unknown[] }).insights ?? []).length) problems.push("AI insights returned no verified insight");
    await page.waitForTimeout(900);
    await say("…and every insight lists the exact figures it used. Any insight quoting a number that isn't in my data is thrown away.", 5200);
    await rec.shot("09-ai-insights");

    const grid = page.locator(".ag-root");
    await grid.scrollIntoViewIfNeeded();
    await say("Every invoice in AG Grid: search, sort and filter.", 0);
    await page.locator("#grid-q").click();
    await page.locator("#grid-q").pressSequentially("Lumen", { delay: 80 });
    await page.waitForTimeout(1600);
    await page.locator("#grid-q").fill("");
    await page.locator(".ag-header-cell", { hasText: "Outstanding" }).click();
    await page.waitForTimeout(1800);
    await rec.shot("10-ag-grid");

    // 10. Audit trail
    await page.getByRole("link", { name: "Activity log" }).first().click();
    await expect(page.getByText("PayPal created the draft invoice").first()).toBeVisible({ timeout: 30_000 });
    await say("Every AI proposal, every approval and every PayPal call is logged, with PayPal's debug ID.", 4200);
    await rec.shot("11-activity-log");

    // 11. Close
    await page.goto("/");
    await say("NEXORA AI: say who owes you. Approve the invoice. PayPal does the rest.", 4200);
  } finally {
    // Always write frames.json, so a failed run still produces a partial video to inspect.
    const r = await rec.stop();
    console.log(`[demo] mode=${MODE} frames=${r.frames} ~${r.seconds}s`);
  }
  if (problems.length) {
    console.warn(`[demo] live-step problems:\n- ${problems.join("\n- ")}`);
    if (real) throw new Error(`Recording is not submission-ready: ${problems.join("; ")}`);
  }
});
