import { expect, test, type Page } from "@playwright/test";

import { seedAccountsFor } from "./helpers/seed-accounts";

// The month loop end to end (spec art_psxjH3kE): signup → onboard → assign →
// CSV import → review → spend (credit + ATM) → danger state → windfall →
// season confirmation → Planned vs Actual. One serial journey on one
// household, because every step builds the ledger the next step reads.
//
// v1 has no account-creation UI (deferred with PR #8), so the household's
// checking/credit/cash accounts are seeded straight into the e2e database —
// the same rows the transaction forms and net-worth card read.

// ─── Session helpers (same shapes as auth-onboarding.spec.ts) ───────────────

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

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Current-month household-local date (engine dates are YYYY-MM-DD, A4). */
function csvDate(day: number): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}-${String(day).padStart(2, "0")}`;
}

/** "September 2026" — the app labels months with en-US + UTC. */
function currentMonthLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function csvFile(rows: string[]): {
  name: string;
  mimeType: string;
  buffer: Buffer;
} {
  return {
    name: "checking-export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      ["Date,Payee,Amount,Memo,Transaction ID,Status", ...rows].join("\n"),
      "utf8",
    ),
  };
}

function section(page: Page, heading: string) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: heading }),
  });
}

test("the month loop: signup → assign → import → review → spend → danger → windfall → season → reports", async ({
  page,
}) => {
  test.setTimeout(180_000);

  const email = await signup(page);
  await completeOnboarding(page);

  // The zero-transaction dashboard keeps the product's structure (v1.1):
  // a hero naming the amount ready to plan, the one CTA, quiet empties.
  const hero = page.getByTestId("hero");
  await expect(hero).toHaveAttribute("data-empty", "");
  await expect(page.getByTestId("ready-to-plan")).toHaveText("$5,000.00");
  await expect(
    hero.getByRole("link", { name: "Plan the month" }),
  ).toHaveAttribute("href", "/planner");
  // Accounts first: nothing else in the flow works without them.
  await seedAccountsFor(email);

  // ── paycheck in, then assign every dollar (D6) ──────────────────────
  await page.goto("/transactions");
  const manual = section(page, "Manual entry");
  await manual
    .getByLabel("Account")
    .selectOption({ label: "Everyday Checking" });
  await manual.getByLabel("Income").check();
  await manual.getByLabel("Amount").fill("5000.00");
  await manual.getByLabel("Payee").fill("Acme Payroll");
  await manual.getByRole("button", { name: "Record transaction" }).click();
  // The form resets on a successful save — the save-confirmation signal.
  await expect(manual.getByLabel("Amount")).toHaveValue("");

  await page.goto("/planner");
  await expect(
    page.getByRole("heading", { name: `${currentMonthLabel()} planner` }),
  ).toBeVisible();
  await expect(page.getByTestId("ready-to-assign")).toHaveText("$5,000.00");

  const plan: Array<[string, string]> = [
    ["Groceries", "400.00"],
    ["Dining Out", "150.00"],
    ["Rent / Mortgage", "1600.00"],
    ["Transportation", "300.00"],
    ["Debt Payoff", "300.00"],
    ["Savings & Funds", "2250.00"],
  ];
  for (const [category, amount] of plan) {
    const input = page.getByLabel(`Assign ${category}`);
    await input.fill(amount);
    await page
      .locator("tr", { has: input })
      .getByRole("button", { name: "Assign" })
      .click();
  }
  await expect(page.getByTestId("ready-to-assign")).toHaveText("$0.00");
  await expect(page.getByText("Every dollar assigned")).toBeVisible();

  // ── import a bank export — twice (D4: re-import is idempotent) ───────────
  await page.goto("/transactions");
  const importSection = section(page, "Import a bank export (CSV)");
  const fileInput = importSection.locator('input[type="file"]');
  const firstExport = csvFile([
    `${csvDate(1)},Fresh Market,-76.25,weekly shop,TXN-001,posted`,
    `${csvDate(2)},Midway Movers,-240.00,truck deposit,TXN-002,posted`,
    `${csvDate(2)},Self Storage Plus,-60.00,first month unit,TXN-003,posted`,
  ]);
  await fileInput.setInputFiles(firstExport);
  // The header-based suggestion pre-fills the mapping — straight to preview.
  await importSection.getByRole("button", { name: "Preview import" }).click();
  await expect(importSection.getByText("3 rows will import")).toBeVisible();
  await importSection
    .getByLabel("Import into")
    .selectOption({ label: "Everyday Checking" });
  await importSection.getByRole("button", { name: "Import 3 rows" }).click();
  await expect(
    importSection.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();
  await expect(importSection.getByText("Imported 3 rows.")).toBeVisible();

  // Same file again: accountId + externalId dedupe keeps the ledger intact.
  await fileInput.setInputFiles(firstExport);
  await importSection.getByRole("button", { name: "Preview import" }).click();
  await expect(importSection.getByText("3 rows will import")).toBeVisible();
  await importSection
    .getByLabel("Import into")
    .selectOption({ label: "Everyday Checking" });
  await importSection.getByRole("button", { name: "Import 3 rows" }).click();
  await expect(
    importSection.getByText(/Skipped 3 already-imported rows/),
  ).toBeVisible();

  // ── review queue: categorize, teach the learner (D5) ──────────────────────
  const queue = section(page, "Review queue");
  await expect(queue.getByText("No suggestion")).toHaveCount(3);

  const freshMarketRow = queue.getByRole("row", { name: /Fresh Market/ });
  await freshMarketRow
    .getByLabel("Category for Fresh Market")
    .selectOption({ label: "Groceries" });
  await freshMarketRow.getByRole("button", { name: "Confirm" }).click();
  await expect(queue.getByRole("row", { name: /Fresh Market/ })).toHaveCount(0);

  const moversRow = queue.getByRole("row", { name: /Midway Movers/ });
  await moversRow
    .getByLabel("Category for Midway Movers")
    .selectOption({ label: "Transportation" });
  await moversRow.getByRole("button", { name: "Confirm" }).click();

  const storageRow = queue.getByRole("row", { name: /Self Storage Plus/ });
  await storageRow
    .getByLabel("Category for Self Storage Plus")
    .selectOption({ label: "Transportation" });
  await storageRow.getByRole("button", { name: "Confirm" }).click();
  await expect(queue.getByText("Nothing to review.")).toBeVisible();

  // A second export: the categorizer now knows this payee exactly (D5).
  await fileInput.setInputFiles(
    csvFile([`${csvDate(3)},Fresh Market,-52.10,restock,TXN-010,posted`]),
  );
  await importSection.getByRole("button", { name: "Preview import" }).click();
  // The preview hint does not pluralize — "1 rows will import" is exact.
  await expect(importSection.getByText("1 rows will import")).toBeVisible();
  await importSection
    .getByLabel("Import into")
    .selectOption({ label: "Everyday Checking" });
  await importSection.getByRole("button", { name: "Import 1 rows" }).click();
  await expect(importSection.getByText("Imported 1 row.")).toBeVisible();

  const learnedRow = queue.getByRole("row", { name: /Fresh Market/ });
  await expect(learnedRow.getByText("Exact match")).toBeVisible();
  await learnedRow.getByRole("button", { name: "Confirm" }).click();
  await expect(queue.getByText("Nothing to review.")).toBeVisible();

  // ── spend: credit depletes the plan, ATM never spends (D2/D4) ────────────
  await manual.getByLabel("Account").selectOption({ label: "Visa Card" });
  await manual.getByLabel("Amount").fill("180.50");
  await manual.getByLabel("Payee").fill("Apthorp Diner");
  await manual
    .getByRole("combobox", { name: /Category/ })
    .selectOption({ label: "Dining Out" });
  await manual.getByRole("button", { name: "Record transaction" }).click();
  await expect(manual.getByLabel("Amount")).toHaveValue("");

  await manual
    .getByLabel("Account")
    .selectOption({ label: "Everyday Checking" });
  await manual.getByLabel("Amount").fill("76.25");
  await manual.getByLabel("Payee").fill("Corner Grocer");
  await manual
    .getByRole("combobox", { name: /Category/ })
    .selectOption({ label: "Groceries" });
  await manual.getByRole("button", { name: "Record transaction" }).click();
  await expect(manual.getByLabel("Amount")).toHaveValue("");

  // ATM: checking → cash wallet. A transfer, never spending — zero categories.
  const transfer = section(page, "Transfer between accounts");
  await transfer
    .getByLabel("From")
    .selectOption({ label: "Everyday Checking" });
  await transfer.getByLabel("To").selectOption({ label: "Cash Wallet" });
  await transfer.getByLabel("Amount").fill("100.00");
  await transfer.getByRole("button", { name: "Record transfer" }).click();
  await expect(transfer.getByLabel("From")).toHaveValue("");

  // ── danger zone: the credit overspend surfaces (D3/D7) ───────────────────
  await page.goto("/dashboard");
  // The hero reads money left and the spent-of-planned supporting line.
  await expect(page.getByTestId("money-left")).toHaveText("$4,314.90");
  await expect(page.getByTestId("spent-of-planned")).toHaveText(
    "$685.10 spent of $5,000.00 planned",
  );
  // The overspent plan earns the Attention card — no alert-strip chrome.
  const attention = page.getByTestId("attention");
  await expect(attention).toContainText(
    "Sika found something that needs attention.",
  );
  await expect(
    attention.getByRole("link", {
      name: "Move money to cover it in the planner",
    }),
  ).toHaveAttribute("href", "/planner");
  // Dining Out spent $180.50 of a $150.00 plan → the row states the overage.
  const diningPlanRow = page.locator("li", {
    has: page.getByText("Dining Out", { exact: true }),
  });
  await expect(diningPlanRow).toHaveAttribute("data-state", "overspent");
  await expect(diningPlanRow).toContainText("$30.50 over");
  await expect(page.getByTestId("net-worth")).toHaveCount(0);
  await expect(page.getByTestId("income-line")).toHaveCount(0);

  // Detection: two confirmed moving-related rows in the window → a candidate
  // with human-readable evidence, waiting on the confirmation gate (D11).
  // The candidate lives inside the Attention card now, not a standalone card.
  const lifeCard = page.getByTestId("life-events");
  const candidate = lifeCard.locator("li", { hasText: "Move" });
  await expect(candidate).toContainText(
    "moving-related transactions in 30 days",
  );
  await expect(
    candidate.getByRole("button", { name: "Confirm" }),
  ).toBeVisible();

  // ── windfall: unexpected income gets a ranked plan (D13) ─────────────────
  await page.goto("/transactions");
  await manual
    .getByLabel("Account")
    .selectOption({ label: "Everyday Checking" });
  await manual.getByLabel("Income").check();
  await manual.getByLabel("Amount").fill("5800.00");
  await manual.getByLabel("Payee").fill("Midyear Bonus");
  await manual.getByRole("button", { name: "Record transaction" }).click();
  await expect(manual.getByLabel("Amount")).toHaveValue("");

  await page.goto("/planner");
  const banner = page.getByTestId("windfall-banner");
  await expect(
    banner.getByText("That's $5,800.00 more than the $5,000.00 you expected"),
  ).toBeVisible();
  await expect(banner.getByText("Unexpected income")).toHaveCount(1);
  await banner.getByRole("button", { name: "Allocate windfall" }).click();

  const proposal = page.getByTestId("windfall-proposal");
  await expect(
    proposal.getByText("Suggested plan for $5,800.00"),
  ).toBeVisible();
  // Ranked waterfall: the overspent category first, then the active goal
  // (BALANCED weighs 50%), and the rest stays flexible in Ready to Assign.
  await expect(
    proposal.getByText("Overspent — cover the shortfall"),
  ).toBeVisible();
  await expect(proposal.getByText("Assign $30.50")).toBeVisible();
  await expect(proposal.getByText("Toward your active goal")).toBeVisible();
  await expect(proposal.getByText("Assign $2,884.75")).toBeVisible();
  await expect(
    proposal.getByText("Stays flexible in Ready to Assign"),
  ).toBeVisible();

  await proposal
    .getByRole("button", { name: "Apply Dining Out suggestion" })
    .click();
  await expect(
    proposal.getByText("Overspent — cover the shortfall"),
  ).toHaveCount(0);
  await expect(page.getByTestId("ready-to-assign")).toHaveText("$5,769.50");
  const diningRow = page.locator("tr", {
    has: page.getByLabel("Assign Dining Out"),
  });
  await expect(diningRow).toContainText("$0.00");

  // ── season: confirm the detected move, apply its proposal (D11/D12) ──────
  await page.goto("/dashboard");
  await page
    .getByTestId("life-events")
    .locator("li", { hasText: "Move" })
    .getByRole("button", { name: "Confirm" })
    .click();
  // Confirmed candidates leave the attention area quietly — no empty-state
  // block renders once nothing needs a decision.
  await expect(
    page.getByTestId("life-events").locator("li", { hasText: "Move" }),
  ).toHaveCount(0);

  await page.goto("/planner");
  await expect(page.getByText("Proposed", { exact: true })).toHaveCount(3);
  const transportProposal = page.locator("tr", {
    hasText: "fuel for the moving-day runs",
  });
  // Season lines compose the current draft with the template target:
  // Transportation $300.00 draft + $25.00 target = $325.00 (was $300.00).
  await expect(transportProposal).toContainText("Assign $325.00");
  await transportProposal
    .getByRole("button", { name: "Apply proposal" })
    .click();
  await expect(page.getByText("fuel for the moving-day runs")).toHaveCount(0);
  const transportRow = page.locator("tr", {
    has: page.getByLabel("Assign Transportation"),
  });
  await expect(transportRow).toContainText("$25.00");

  // ── planned vs actual + the annual view (D9) ──────────────────────────────
  await page.goto("/reports");
  const month = page.locator(
    `section[aria-label="Planned vs actual — ${currentMonthLabel()}"]`,
  );
  // The month strip: no fund draws, so nothing popped up, and the retro
  // paragraph carries the received-income figure.
  const stripTiles = month.locator(".month-strip > div");
  await expect(stripTiles.filter({ hasText: "Popped up" })).toContainText(
    "$0.00",
  );
  await expect(month.getByText(/Income received \$10,800\.00/)).toBeVisible();
  const groceriesRow = month.locator("tr", { hasText: "Groceries" });
  await expect(groceriesRow).toContainText("$400.00");
  await expect(groceriesRow).toContainText("Saved");
  await expect(month.locator("tr", { hasText: "Dining Out" })).toContainText(
    "As planned",
  );

  const annual = page.locator('section[aria-label$="in review"]');
  await expect(
    annual.getByRole("heading", {
      name: `${new Date().getUTCFullYear()} in review`,
    }),
  ).toBeVisible();
  await expect(annual.getByText("Move", { exact: true })).toBeVisible();
});
