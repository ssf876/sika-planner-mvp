import { expect, test, type Page } from "@playwright/test";

// D10/D7 verification: signup → onboard → dashboard (spec art_psxjH3kE).
// Each test signs up a fresh unique email, so runs are isolated in the shared
// e2e database without needing a per-run reset.
const PASSWORD = "correct-horse-battery";

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function signup(page: Page): Promise<string> {
  const email = uniqueEmail();
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/onboarding");
  return email;
}

async function completeOnboarding(page: Page): Promise<void> {
  await page.getByLabel("Pay off debt faster").check();
  await page.getByLabel("How much do you make per month?").fill("5000");
  await page.getByLabel("Just me").check();
  await page.getByRole("button", { name: "Start budgeting" }).click();
  await page.waitForURL("**/dashboard");
}

test("signup → onboard → zero-transaction dashboard", async ({ page }) => {
  await signup(page);
  await completeOnboarding(page);

  // v1.1: with no transactions yet the dashboard keeps the product's
  // structure — a hero that names the amount ready to plan, the one CTA,
  // and quiet plan/activity empties. No giant instructional card.
  const hero = page.getByTestId("hero");
  await expect(hero).toBeVisible();
  await expect(hero).toHaveAttribute("data-empty", "");
  await expect(page.getByTestId("ready-to-plan")).toHaveText("$5,000.00");
  await expect(
    hero.getByRole("link", { name: "Plan the month" }),
  ).toHaveAttribute("href", "/planner");
  await expect(page.getByTestId("plan-group-needs")).toBeVisible();
  await expect(page.getByTestId("activity-empty")).toBeVisible();
  await expect(page.getByTestId("attention")).toHaveCount(0);
});

test("login returns an onboarded user to their dashboard", async ({ page }) => {
  const email = await signup(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("/");

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");

  // The v1.1 hero: quiet month eyebrow over the ready-to-plan value.
  await expect(page.getByTestId("hero")).toBeVisible();
  await expect(page.getByTestId("ready-to-plan")).toHaveText("$5,000.00");
});

test("unauthenticated visits to protected routes bounce to login", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.waitForURL(/\/login/);

  await page.goto("/onboarding");
  await page.waitForURL(/\/login/);
});

test("short passwords are rejected at signup", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/signup/);
});
