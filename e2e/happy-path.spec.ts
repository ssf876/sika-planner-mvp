import { expect, test, type Page } from "@playwright/test";

// The month loop end to end (spec art_psxjH3kE): signup → onboard → set up
// accounts → assign → CSV import → review → spend (credit + ATM) → danger
// state → windfall → season confirmation → Planned vs Actual. One serial
// journey on one household, because every step builds the ledger the next
// step reads.
//
// v1.1 PR 4 added the first-run account setup step, so every account in this
// journey is created through the UI during onboarding — zero seeded database
// state anywhere in the flow.

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

/**
 * Applied confirmations are a short beat by design (they collapse after a
 * moment), and the server action before one can be slow on a cold dev server
 * (first invocation compiles the action chunk). The expect timeout only has
 * to outlive that compile — the assertion passes the instant the note shows.
 */
const APPLIED_NOTE_TIMEOUT = 15_000;

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

  await signup(page);
  await completeOnboarding(page);

  // Accounts first: nothing else in the flow works without them. All three
  // come through the onboarding setup step — the same names, kinds, and
  // starting balances the seeded journey used, so the money math below is
  // identical.
  await createAccountViaSetup(page, {
    kind: "Checking",
    name: "Everyday Checking",
    startingBalance: "1,200",
  });
  await createAccountViaSetup(page, { kind: "Credit card", name: "Visa Card" });
  await createAccountViaSetup(page, {
    kind: "Cash wallet",
    name: "Cash Wallet",
    startingBalance: "40",
  });
  await page.getByRole("link", { name: "Go to your dashboard" }).click();
  await page.waitForURL("**/dashboard");

  // The zero-transaction dashboard keeps the product's structure (v1.1):
  // a hero naming the amount ready to plan, the one CTA, quiet empties.
  const hero = page.getByTestId("hero");
  await expect(hero).toHaveAttribute("data-empty", "");
  await expect(page.getByTestId("ready-to-plan")).toHaveText("$5,000.00");
  await expect(
    hero.getByRole("link", { name: "Plan the month" }),
  ).toHaveAttribute("href", "/planner");

  // ── paycheck in, then assign every dollar (D6) ──────────────────────
  // The empty planner is honest: no income and nothing assigned yet —
  // never a premature "every dollar assigned" celebration (v1.1 fix).
  await page.goto("/planner");
  await expect(
    page.getByText(
      "Nothing to assign yet — Add this month's income to start your plan.",
    ),
  ).toBeVisible();

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
  // Planned values are edited in place: open the value, type, Enter — the
  // same existing assignment action saves it (v1.1 inline editing).
  for (const [category, amount] of plan) {
    await page
      .getByRole("button", { name: `Edit planned amount for ${category}` })
      .click();
    const input = page.getByRole("textbox", {
      name: `Planned amount for ${category}`,
    });
    await input.fill(amount);
    await input.press("Enter");
    // The editor closes back into the value once the server confirms.
    await expect(input).toHaveCount(0);
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
  // The applied line names what just happened, then collapses out of the
  // plan.
  await expect(
    proposal.getByText("Applied — $30.50 to Dining Out."),
  ).toBeVisible({ timeout: APPLIED_NOTE_TIMEOUT });
  await expect(
    proposal.getByText("Overspent — cover the shortfall"),
  ).toHaveCount(0);
  await expect(page.getByTestId("ready-to-assign")).toHaveText("$5,769.50");
  const diningRow = page.getByRole("listitem").filter({
    has: page.getByRole("button", {
      name: "Edit planned amount for Dining Out",
    }),
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
  const recommendations = page.getByTestId("recommendations");
  // Season proposals render as separate Sika recommendation cards — never
  // tinted rows dropped into the plan.
  await expect(recommendations.getByText("What Sika noticed")).toHaveCount(3);
  const transportCard = recommendations
    .locator("article[data-testid^='proposal-']")
    .filter({ hasText: "fuel for the moving-day runs" });
  // Season lines compose the current draft with the template target:
  // Transportation $300.00 draft + $25.00 target = $325.00 (was $300.00).
  await expect(transportCard).toContainText(
    "Suggests $325.00 to Transportation",
  );
  await expect(transportCard).toContainText(
    "Transportation goes from $300.00 to $325.00 planned",
  );
  await transportCard.getByRole("button", { name: "Apply" }).click();
  await expect(
    recommendations.getByText("Applied — $325.00 to Transportation."),
  ).toBeVisible({ timeout: APPLIED_NOTE_TIMEOUT });
  await expect(
    recommendations.getByText("fuel for the moving-day runs"),
  ).toHaveCount(0);
  const transportRow = page.getByRole("listitem").filter({
    has: page.getByRole("button", {
      name: "Edit planned amount for Transportation",
    }),
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
