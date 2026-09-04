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
  // First-run account setup (v1.1 PR 4): the budget is seeded, now the
  // household needs an account before the dashboard makes sense.
  await page.waitForURL("**/onboarding/accounts");
}

/** Create one account through the setup step's form and stay on the step. */
async function createAccountViaSetup(
  page: Page,
  account: { kind: string; name: string; startingBalance?: string },
): Promise<void> {
  await page.getByRole("radio", { name: account.kind }).check();
  await page.getByLabel("Account name").fill(account.name);
  if (account.startingBalance) {
    await page.getByLabel("Starting balance").fill(account.startingBalance);
  }
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `Created ${account.name}.` }),
  ).toBeVisible();
}

test("signup → onboard → first account → zero-transaction dashboard", async ({
  page,
}) => {
  await signup(page);
  await completeOnboarding(page);

  // The setup step: four first-run kinds, one account to start with.
  await expect(
    page.getByRole("heading", { name: "Set up your first account" }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "Investment" })).toHaveCount(0);
  await createAccountViaSetup(page, {
    kind: "Checking",
    name: "Everyday Checking",
    startingBalance: "1,200",
  });
  await page.getByRole("link", { name: "Go to your dashboard" }).click();
  await page.waitForURL("**/dashboard");

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
  await createAccountViaSetup(page, {
    kind: "Checking",
    name: "Everyday Checking",
    startingBalance: "1,200",
  });
  await page.getByRole("link", { name: "Go to your dashboard" }).click();
  await page.waitForURL("**/dashboard");

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
