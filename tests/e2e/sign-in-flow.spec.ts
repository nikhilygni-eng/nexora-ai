import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * REPRODUCTION (plain Playwright, no demo-recorder helpers):
 * does landing page → "Open workspace" → sign in → Command Center work?
 *
 * Each test logs the sign-in related requests the browser really made, so the log shows whether
 * a failure is the app (router/cookie) or timing (typing before the page is interactive).
 */

// Own client address, so these sign-ins don't share the login rate-limit bucket with other specs.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.7" } });

const PASSCODE = "e2e-passcode";

type Trace = { phase: string; lines: string[] };

function traceAuthRequests(page: Page): Trace {
  const trace: Trace = { phase: "page load", lines: [] };
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname !== "/app" && u.pathname !== "/login" && u.pathname !== "/api/auth/login") return;
    const h = r.request().headers();
    const kind = h["next-router-prefetch"] ? "prefetch" : h["rsc"] ? "rsc" : r.request().resourceType();
    const location = r.headers()["location"];
    const search = u.search.replace(/_rsc=[^&]+/, "_rsc=…");
    trace.lines.push(`[${trace.phase}] ${r.request().method()} ${u.pathname}${search} (${kind}) → ${r.status()}${location ? ` → ${location.replace(/_rsc=[^&]+/, "_rsc=…")}` : ""}`);
  });
  return trace;
}

/** Sign in on the page that's open. Waits until the page is interactive first, so typing can't be lost. */
async function signIn(page: Page, context: BrowserContext, trace: Trace) {
  await page.waitForLoadState("networkidle");
  await page.fill("#pc", PASSCODE);
  await expect(page.locator("#pc")).toHaveValue(PASSCODE);
  trace.phase = "after sign-in";
  const login = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
  await page.click("button[type=submit]");
  const status = (await login).status();
  const hasCookie = (await context.cookies()).some((c) => c.name === "nexora_session" && c.value.length > 0);
  trace.lines.push(`[after sign-in] sign-in API status ${status}; session cookie present: ${hasCookie ? "yes" : "no"}`);
  expect(status).toBe(200);
  expect(hasCookie).toBe(true);
}

async function report(page: Page, trace: Trace, name: string) {
  await page.waitForTimeout(1500); // let any late requests land in the log
  console.log(`\n=== ${name}\nfinal URL: ${page.url()}\n${trace.lines.join("\n")}\n`);
}

test("CONTROL: sign-in page opened directly → Command Center", async ({ page, context }) => {
  const trace = traceAuthRequests(page);
  try {
    await page.goto("/login?next=%2Fapp");
    await signIn(page, context, trace);
    await expect(page).toHaveURL(/\/app$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  } finally {
    await report(page, trace, "CONTROL direct sign-in page");
  }
});

test("BUG PATH: landing → Open workspace → sign in → Command Center", async ({ page, context }) => {
  const trace = traceAuthRequests(page);
  try {
    const prefetch = page.waitForResponse((r) => new URL(r.url()).pathname === "/app", { timeout: 8_000 }).catch(() => null);
    await page.goto("/");
    await prefetch; // Next prefetches the page's links once they're on screen
    await page.waitForLoadState("networkidle");
    trace.phase = "after clicking Open workspace";
    await page.getByRole("link", { name: "Open workspace" }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
    await signIn(page, context, trace);
    await expect(page).toHaveURL(/\/app$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  } finally {
    await report(page, trace, "BUG PATH landing → Open workspace");
  }
});

test("BUG PATH 2: landing → Draft my first invoice → sign in → Command Center", async ({ page, context }) => {
  const trace = traceAuthRequests(page);
  try {
    const prefetch = page.waitForResponse((r) => new URL(r.url()).pathname === "/app", { timeout: 8_000 }).catch(() => null);
    await page.goto("/");
    await prefetch;
    await page.waitForLoadState("networkidle");
    trace.phase = "after clicking Draft my first invoice";
    await page.getByRole("link", { name: "Draft my first invoice" }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
    await signIn(page, context, trace);
    await expect(page).toHaveURL(/\/app$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  } finally {
    await report(page, trace, "BUG PATH 2 landing → Draft my first invoice");
  }
});

test("CONTROL: landing → Open workspace → reload the sign-in page (clears the browser's in-memory route cache) → sign in", async ({ page, context }) => {
  const trace = traceAuthRequests(page);
  try {
    const prefetch = page.waitForResponse((r) => new URL(r.url()).pathname === "/app", { timeout: 8_000 }).catch(() => null);
    await page.goto("/");
    await prefetch;
    await page.waitForLoadState("networkidle");
    trace.phase = "after clicking Open workspace";
    await page.getByRole("link", { name: "Open workspace" }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
    trace.phase = "after reloading the sign-in page";
    await page.reload();
    await signIn(page, context, trace);
    await expect(page).toHaveURL(/\/app$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  } finally {
    await report(page, trace, "CONTROL reload before sign-in");
  }
});
