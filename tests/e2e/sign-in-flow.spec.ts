import { expect, test, type Page } from "@playwright/test";

/**
 * Regression: a visitor's normal way in — landing page → "Open workspace" → sign in — must reach
 * the Command Center and stay signed in after a refresh.
 *
 * The bug this guards against: the landing page's links make the browser prefetch /app while the
 * visitor is signed out, and the server answers with a redirect to the sign-in page. The browser's
 * in-memory route cache remembered that answer, so after a successful sign-in, navigating to /app
 * through the client router landed back on the sign-in page. Sign-in now does a full page load.
 */

// Own client address, so these sign-ins don't share the login rate-limit bucket with other specs.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.7" } });

const PASSCODE = "e2e-passcode";

/** Open the landing page and let the browser finish prefetching its links, as it does for a real visitor. */
async function openLanding(page: Page) {
  const prefetch = page.waitForResponse((r) => new URL(r.url()).pathname === "/app", { timeout: 8_000 }).catch(() => null);
  await page.goto("/");
  await prefetch;
  await page.waitForLoadState("networkidle");
}

async function signIn(page: Page) {
  await page.waitForLoadState("networkidle"); // the page is interactive, so typing can't be lost
  await page.fill("#pc", PASSCODE);
  await expect(page.locator("#pc")).toHaveValue(PASSCODE);
  const login = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"));
  await page.click("button[type=submit]");
  expect((await login).status(), "sign-in request").toBe(200);
}

async function expectCommandCenterAndStaysSignedIn(page: Page) {
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  expect((await page.request.get("/api/settings")).status(), "signed-in API call after refresh").toBe(200);
}

test("landing → Open workspace → sign in reaches the Command Center and survives a refresh", async ({ page }) => {
  await openLanding(page);
  await page.getByRole("link", { name: "Open workspace" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
  await signIn(page);
  await expectCommandCenterAndStaysSignedIn(page);
});

test("landing → Draft my first invoice → sign in reaches the Command Center and survives a refresh", async ({ page }) => {
  await openLanding(page);
  await page.getByRole("link", { name: "Draft my first invoice" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
  await signIn(page);
  await expectCommandCenterAndStaysSignedIn(page);
});

test("sign-in returns to the page that asked for it", async ({ page }) => {
  await page.goto("/app/analytics"); // signed out → sent to sign in, remembering where we were going
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fanalytics$/);
  await signIn(page);
  await expect(page).toHaveURL(/\/app\/analytics$/);
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
});

test("sign-in never leaves the site, whatever the next parameter says", async ({ page }) => {
  await page.goto("/login?next=https%3A%2F%2Fexample.com%2Fapp");
  await signIn(page);
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/app$/);
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
});
