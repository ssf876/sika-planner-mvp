import { expect, test } from "@playwright/test";

// Smoke check only — meaningful e2e flows (signup -> onboard -> dashboard)
// arrive with D10 per the spec's verification plan.
test("home page renders the app title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Sika Planner/);
});
