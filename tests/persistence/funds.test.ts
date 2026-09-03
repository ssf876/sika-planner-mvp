import { beforeEach, describe, expect, it } from "vitest";

import {
  contributeToFund,
  createFund,
  listFundBoard,
  recordPopupDraw,
  recordStaticDraw,
} from "@/lib/repositories/funds";
import { recordManualTransaction } from "@/lib/repositories/transactions";

import {
  resetDatabase,
  seedHousehold,
  testDb,
  type SeededHousehold,
} from "./test-db";

let seeded: SeededHousehold;

beforeEach(async () => {
  await resetDatabase();
  seeded = await seedHousehold(`funds-${crypto.randomUUID()}`);
});

/** Sinking fund with $500 contributed and $300 assigned to its companion. */
async function seedSinkingFund() {
  const { id: fundId } = await createFund(testDb, seeded.householdId, {
    kind: "SINKING",
    name: "Car repairs",
    targetCents: 100000,
    targetDate: "2027-03-01",
  });
  const companion = await testDb.category.findFirstOrThrow({
    where: { fundId },
  });
  await contributeToFund(testDb, seeded.householdId, {
    fundId,
    amountCents: 50000,
  });
  return { fundId, companionId: companion.id };
}

async function seedStaticFund() {
  const { id: fundId } = await createFund(testDb, seeded.householdId, {
    kind: "STATIC",
    name: "Emergency fund",
  });
  await contributeToFund(testDb, seeded.householdId, {
    fundId,
    amountCents: 80000,
  });
  return { fundId };
}

async function seedIncome(cents: number) {
  await recordManualTransaction(testDb, seeded.householdId, {
    accountId: seeded.accountIds.checking,
    kind: "INCOME",
    amountCents: cents,
    date: "2026-09-01",
    payee: "Employer",
  });
}

describe("createFund — sinking funds get a companion category (D8)", () => {
  it("auto-creates a companion category named after the fund", async () => {
    const { id } = await createFund(testDb, seeded.householdId, {
      kind: "SINKING",
      name: "Holidays",
    });

    const fund = await testDb.fund.findUniqueOrThrow({ where: { id } });
    expect(fund.kind).toBe("SINKING");
    expect(fund.balanceCents).toBe(0);
    expect(fund.targetCents).toBeNull();

    const companion = await testDb.category.findFirstOrThrow({
      where: { fundId: id },
    });
    expect(companion.name).toBe("Holidays");
    expect(companion.group).toBe("SAVINGS_DEBTS");
    expect(companion.householdId).toBe(seeded.householdId);
  });

  it("links a chosen existing category instead of creating one", async () => {
    const { id } = await createFund(testDb, seeded.householdId, {
      kind: "SINKING",
      name: "Groceries buffer",
      companionCategoryId: seeded.categoryIds.groceries,
    });

    const linked = await testDb.category.findUniqueOrThrow({
      where: { id: seeded.categoryIds.groceries },
    });
    expect(linked.fundId).toBe(id);
  });

  it("refuses a category that already backs another fund", async () => {
    // A second sinking fund auto-creates and owns its own companion; offering
    // that companion to a new fund must be refused in application code.
    await seedSinkingFund();
    const second = await createFund(testDb, seeded.householdId, {
      kind: "SINKING",
      name: "Second fund",
    });
    const secondCompanion = await testDb.category.findFirstOrThrow({
      where: { fundId: second.id },
    });

    await expect(
      createFund(testDb, seeded.householdId, {
        kind: "SINKING",
        name: "Third fund",
        companionCategoryId: secondCompanion.id,
      }),
    ).rejects.toMatchObject({ name: "RepositoryError" });
  });

  it("static funds stay uncoupled when no category is chosen", async () => {
    const { id } = await createFund(testDb, seeded.householdId, {
      kind: "STATIC",
      name: "Nest egg",
    });
    expect(await testDb.category.count({ where: { fundId: id } })).toBe(0);
  });
});

describe("contributeToFund — the fund's own ledger (D8)", () => {
  it("increments the balance and rejects non-positive amounts", async () => {
    const { fundId } = await seedSinkingFund();

    const { balanceCents } = await contributeToFund(
      testDb,
      seeded.householdId,
      { fundId, amountCents: 25000 },
    );
    expect(balanceCents).toBe(75000);

    await expect(
      contributeToFund(testDb, seeded.householdId, {
        fundId,
        amountCents: 0,
      }),
    ).rejects.toMatchObject({ name: "RepositoryError" });
  });

  it("never touches another household's fund", async () => {
    const { fundId } = await seedSinkingFund();
    const other = await seedHousehold(`other-${crypto.randomUUID()}`);

    await expect(
      contributeToFund(testDb, other.householdId, { fundId, amountCents: 100 }),
    ).rejects.toMatchObject({
      name: "RepositoryError",
      code: "NOT_FOUND",
    });
    const untouched = await testDb.fund.findUniqueOrThrow({
      where: { id: fundId },
    });
    expect(untouched.balanceCents).toBe(50000);
  });
});

describe("recordPopupDraw — sinking semantics through the persisted engine (D8)", () => {
  it("fund −, expense posts against the companion, month cashflow releases +, Ready to Assign untouched", async () => {
    await seedIncome(100000);
    const { fundId, companionId } = await seedSinkingFund();
    // Plan $300 into the companion category for September.
    await testDb.allocation.create({
      data: {
        monthId: seeded.monthId,
        categoryId: companionId,
        assignedCents: 30000,
      },
    });
    const baseline = await recordManualTransaction(
      testDb,
      seeded.householdId,
      {
        accountId: seeded.accountIds.checking,
        kind: "EXPENSE",
        amountCents: -1,
        date: "2026-09-02",
        payee: "warmup",
        categoryId: seeded.categoryIds.groceries,
      },
    );
    expect(baseline.readyToAssignCents).toBe(70000);

    const result = await recordPopupDraw(testDb, seeded.householdId, {
      fundId,
      accountId: seeded.accountIds.checking,
      amountCents: 24000,
      date: "2026-09-14",
      payee: "Midwest Movers",
    });

    // The draw row and the expense it paid are both persisted.
    const draw = await testDb.fundDraw.findUniqueOrThrow({
      where: { id: result.drawId },
    });
    expect(draw.fundId).toBe(fundId);
    expect(draw.monthId).toBe(seeded.monthId);
    expect(draw.amountCents).toBe(24000);

    const expense = await testDb.transaction.findFirstOrThrow({
      where: { fundDrawId: result.drawId },
    });
    expect(expense.kind).toBe("EXPENSE");
    expect(expense.amountCents).toBe(-24000);
    expect(expense.categoryId).toBe(companionId);
    expect(expense.payee).toBe("Midwest Movers");

    // Fund −
    expect(result.fundBalanceCents).toBe(26000);

    // Month cashflow + — the draw is income for the month, never paycheck income.
    expect(result.monthCashflow.fundDrawCents).toBe(24000);
    // The pop-up's expense counts as spending, alongside the 1-cent warmup.
    expect(result.monthCashflow.spendingCents).toBe(24001);
    expect(result.monthCashflow.netCashflowCents).toBe(100000 + 24000 - 24001);

    // Ready to Assign never moves for a draw — cashflow, not income.
    expect(result.readyToAssignCents).toBe(70000);

    // The companion category is made whole: assigned − spent + released.
    const companion = result.categoryAvailability.find(
      (c) => c.categoryId === companionId,
    );
    expect(companion).toMatchObject({
      assignedCents: 30000,
      spentCents: 24000,
      cashflowReleasedCents: 24000,
      availableCents: 30000,
    });

    // A fresh hydration of the database tells the same story — the persisted
    // engine agrees with the returned views.
    const { loadHouseholdEngineState } = await import(
      "@/lib/repositories/engine-state"
    );
    const { createBudgetEngine } = await import("@/src/engine");
    const engine = createBudgetEngine(
      await loadHouseholdEngineState(testDb, seeded.householdId),
    );
    expect(engine.fundBalanceCents(fundId)).toBe(26000);
    expect(engine.monthCashflow(seeded.monthId).fundDrawCents).toBe(24000);
    expect(engine.readyToAssignCents(seeded.monthId)).toBe(70000);
  });

  it("scaffolds the month when the pop-up lands beyond the planned month", async () => {
    const { fundId } = await seedSinkingFund();

    const result = await recordPopupDraw(testDb, seeded.householdId, {
      fundId,
      accountId: seeded.accountIds.checking,
      amountCents: 9000,
      date: "2026-10-05",
      payee: "Fairway Towing",
    });

    const scaffolded = await testDb.month.findUniqueOrThrow({
      where: { id: result.monthId },
    });
    expect([scaffolded.year, scaffolded.month]).toEqual([2026, 10]);
  });

  it("refuses a pop-up on a static fund and persists nothing", async () => {
    const { fundId } = await seedStaticFund();

    await expect(
      recordPopupDraw(testDb, seeded.householdId, {
        fundId,
        accountId: seeded.accountIds.checking,
        amountCents: 1000,
        date: "2026-09-15",
        payee: "Nope",
      }),
    ).rejects.toMatchObject({
      name: "EngineError",
      code: "FUND_KIND_MISMATCH",
    });
    expect(await testDb.fundDraw.count()).toBe(0);
    expect(await testDb.transaction.count()).toBe(0);
  });

  it("never draws from another household's fund", async () => {
    const { fundId } = await seedSinkingFund();
    const other = await seedHousehold(`other-${crypto.randomUUID()}`);

    await expect(
      recordPopupDraw(testDb, other.householdId, {
        fundId,
        accountId: other.accountIds.checking,
        amountCents: 1000,
        date: "2026-09-15",
        payee: "Nope",
      }),
    ).rejects.toMatchObject({ name: "EngineError", code: "UNKNOWN_FUND" });
    expect(await testDb.fundDraw.count()).toBe(0);
  });
});

describe("recordStaticDraw — static goals move only on explicit draw (D8)", () => {
  it("draws the goal, reports popped up, creates no income and no category effect", async () => {
    await seedIncome(100000);
    const { fundId } = await seedStaticFund();

    const result = await recordStaticDraw(testDb, seeded.householdId, {
      fundId,
      amountCents: 50000,
      date: "2026-09-20",
    });

    const draw = await testDb.fundDraw.findUniqueOrThrow({
      where: { id: result.drawId },
    });
    expect(draw.amountCents).toBe(50000);
    expect(draw.monthId).toBe(seeded.monthId);

    // No expense posts for the draw — a static draw is uncoupled from
    // categories (the only transaction in this household is the seeded income).
    expect(
      await testDb.transaction.count({ where: { fundDrawId: result.drawId } }),
    ).toBe(0);

    // Fund −
    expect(result.fundBalanceCents).toBe(30000);

    // Reported as popped up for the month…
    expect(result.monthCashflow.fundDrawCents).toBe(50000);
    // …without income: Ready to Assign is untouched, spending untouched.
    expect(result.readyToAssignCents).toBe(100000);
    expect(result.monthCashflow.spendingCents).toBe(0);
    expect(result.monthCashflow.incomeReceivedCents).toBe(100000);

    // No category moved: released stays 0 everywhere.
    expect(
      result.categoryAvailability.every((c) => c.cashflowReleasedCents === 0),
    ).toBe(true);
  });

  it("refuses a static-draw op on a sinking fund and persists nothing", async () => {
    const { fundId } = await seedSinkingFund();

    await expect(
      recordStaticDraw(testDb, seeded.householdId, {
        fundId,
        amountCents: 1000,
        date: "2026-09-15",
      }),
    ).rejects.toMatchObject({
      name: "EngineError",
      code: "FUND_KIND_MISMATCH",
    });
    expect(await testDb.fundDraw.count()).toBe(0);
  });
});

describe("listFundBoard — the board's read view (D8)", () => {
  it("reports funds, draws with popped-up labels, and this month's cashflow", async () => {
    const sinking = await seedSinkingFund();
    const static_ = await seedStaticFund();

    await recordPopupDraw(testDb, seeded.householdId, {
      fundId: sinking.fundId,
      accountId: seeded.accountIds.checking,
      amountCents: 24000,
      date: "2026-09-14",
      payee: "Midwest Movers",
    });
    await recordStaticDraw(testDb, seeded.householdId, {
      fundId: static_.fundId,
      amountCents: 50000,
      date: "2026-09-20",
    });

    const board = await listFundBoard(testDb, seeded.householdId);

    expect(board.month.fundDrawCents).toBe(74000);
    expect(board.month.incomeReceivedCents).toBe(0);
    expect(board.month.spendingCents).toBe(24000);
    expect(board.month.netCashflowCents).toBe(50000);

    const sinkingEntry = board.funds.find((f) => f.id === sinking.fundId);
    expect(sinkingEntry).toMatchObject({
      kind: "SINKING",
      balanceCents: 26000,
      targetCents: 100000,
    });
    expect(sinkingEntry?.companionCategory).not.toBeNull();
    expect(sinkingEntry?.draws).toHaveLength(1);
    expect(sinkingEntry?.draws[0]).toMatchObject({
      monthLabel: "September 2026",
      amountCents: 24000,
      paidExpense: true,
      expensePayee: "Midwest Movers",
    });

    const staticEntry = board.funds.find((f) => f.id === static_.fundId);
    expect(staticEntry).toMatchObject({
      kind: "STATIC",
      balanceCents: 30000,
    });
    expect(staticEntry?.companionCategory).toBeNull();
    expect(staticEntry?.draws[0]).toMatchObject({
      monthLabel: "September 2026",
      amountCents: 50000,
      paidExpense: false,
    });
  });

  it("reports zero cashflow for a month with no activity", async () => {
    await seedSinkingFund();
    const board = await listFundBoard(testDb, seeded.householdId);
    expect(board.month.monthId).not.toBeNull();
    expect(board.month.fundDrawCents).toBe(0);
    expect(board.month.incomeReceivedCents).toBe(0);
    expect(board.funds).toHaveLength(1);
  });
});
