import { expect, test, type Page } from "@playwright/test";

import { DEFAULT_CATEGORIES } from "@/lib/onboarding/seed";

// D10 verification: signup → onboard → scaffolded dashboard (spec art_psxjH3kE).
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

test("signup → onboard → scaffolded dashboard", async ({ page }) => {
  await signup(page);
  await completeOnboarding(page);

  // Scaffolded month: current calendar month, Ready to Assign = entered income.
  const monthName = new Date().toLocaleString("en-US", { month: "long" });
  await expect(
    page.getByRole("heading", { name: `${monthName} Budget` }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ready to assign" }),
  ).toBeVisible();
  await expect(page.locator(".ready-to-assign")).toHaveText("$5,000.00");

  // Mock-up category sections seeded.
  for (const group of ["Needs", "Wants", "Savings & Debts", "Investments"]) {
    await expect(
      page.getByRole("heading", { name: group, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByText("Groceries")).toBeVisible();

  // Every seeded category starts $0 assigned (count from the seed source of truth).
  const assignedRows = page.locator(".category-row");
  await expect(assignedRows).toHaveCount(
    Object.values(DEFAULT_CATEGORIES).flat().length,
  );
  await expect(assignedRows.first()).toContainText("$0.00 assigned");
});

test("login returns an onboarded user to their dashboard", async ({ page }) => {
  const email = await signup(page);
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("/");

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
  await expect(
    page.getByRole("heading", { name: "Ready to assign" }),
  ).toBeVisible();
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
