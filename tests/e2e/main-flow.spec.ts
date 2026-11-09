import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("unauthenticated users are sent to sign in", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
  await page.fill("#pc", "wrong-passcode");
  await page.click("button[type=submit]");
  await expect(page.getByRole("alert").filter({ hasText: "isn't right" })).toBeVisible();
});

test("request → follow-up → approve → PayPal (mock) → paid", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#pc", "e2e-passcode");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
  await expect(page.getByText("Mock PayPal · no real calls")).toBeVisible();

  await page.fill("#composer", "Bill Acme Corp $800 for the landing page redesign, due in 14 days.");
  await page.keyboard.press("Enter");
  await expect(page.getByText("What's the client's email address?")).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);

  await page.fill("#composer", "ap@acme.com");
  await page.keyboard.press("Enter");
  const approve = page.getByRole("button", { name: "Approve & send via PayPal" });
  await expect(approve).toBeVisible();
  await expect(page.getByText("Nothing is sent to PayPal until you approve.")).toBeVisible();

  // Edit: change the amount, totals recompute server-side.
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Item 1 unit amount").fill("850");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("$850.00").first()).toBeVisible();

  // Double-click protection: the button disables while the request is in flight.
  await approve.click();
  await expect(page.getByText("Invoice sent")).toBeVisible();
  const paypalId = (await page.getByText(/^INV2-MOCK-/).textContent())!.trim();
  await expect(page.getByRole("button", { name: "Approve & send via PayPal" })).toHaveCount(0);

  await page.getByRole("link", { name: "Track payment" }).click();
  await expect(page.getByText(paypalId)).toBeVisible();
  await expect(page.getByText("SENT", { exact: true })).toBeVisible();

  // AI drafts a reminder; it is not sent until approved.
  await page.getByRole("button", { name: "Draft reminder with AI" }).click();
  await expect(page.getByRole("button", { name: "Approve & send reminder" })).toBeVisible();
  await page.getByRole("button", { name: "Approve & send reminder" }).click();
  await expect(page.getByText("PayPal sent the reminder")).toBeVisible();

  // Simulate the payer paying (mock only) and sync status back from "PayPal".
  await page.getByRole("button", { name: "Simulate payment (mock only)" }).click();
  await expect(page.getByText("PAID", { exact: true })).toBeVisible();

  await page.goto("/app/activity");
  await expect(page.getByText("PayPal created the draft invoice")).toBeVisible();
  await expect(page.getByText("PayPal sent a reminder")).toBeVisible();
});

test("analytics shows demo data labeled, with the AG Grid", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#pc", "e2e-passcode");
  await page.click("button[type=submit]");
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText(/Loaded 15 demo invoices/)).toBeVisible();
  await page.goto("/app/analytics");
  await expect(page.getByText("Outstanding").first()).toBeVisible();
  await expect(page.locator(".ag-root")).toBeVisible();
  await expect(page.getByText("Demo data").first()).toBeVisible();
  await expect(page.getByText("Mock PayPal").first()).toBeVisible();
});
