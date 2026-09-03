import { describe, expect, it } from "vitest";

import { createBudgetEngine, EngineError } from "@/src/engine";

import { buildFixture, type Fixture } from "./fixtures";

// Planned-vs-Actual report math (D9): the plan vs what actually happened,
// split into saved / popped up / went as planned. Every scenario drives real
// engine ops (assign, recordTransaction, draws) and reads the report back,
// so the report can never disagree with the ledger it reports on.

type Engine = ReturnType<typeof createBudgetEngine>;

function errorOf(run: () => unknown): EngineError {
  try {
    run();
    return expect.unreachable("expected EngineError");
  } catch (error) {
    if (!(error instanceof EngineError)) throw error;
    return error;
  }
}

/** A June with income, a three-category plan, mixed spending, and a pop-up. */
function juneWithActivity(): { engine: Engine; fx: Fixture } {
  const fx = buildFixture();
  const engine = createBudgetEngine(fx.state);

  engine.recordTransaction({
    accountId: fx.ids.checkingId,
    kind: "INCOME",
    amountCents: 250_000,
    date: "2026-06-01",
    payee: "Paycheck",
  });
  engine.assign(fx.ids.monthJunId, fx.ids.groceriesId, 100_000);
  engine.assign(fx.ids.monthJunId, fx.ids.diningId, 50_000);
  engine.assign(fx.ids.monthJunId, fx.ids.carRepairId, 20_000);

  // Groceries inside the ±10% band (variance +5,000 ≤ 10,000) → as-planned.
  engine.recordTransaction({
    accountId: fx.ids.creditId,
    kind: "EXPENSE",
    categoryId: fx.ids.groceriesId,
    amountCents: -95_000,
    date: "2026-06-10",
    payee: "Supermarket",
  });
  // Dining past the band (variance −10,000 > 5,000) → overspent.
  engine.recordTransaction({
    accountId: fx.ids.creditId,
    kind: "EXPENSE",
    categoryId: fx.ids.diningId,
    amountCents: -60_000,
    date: "2026-06-12",
    payee: "Bistro",
  });
  // The car fund pays a pop-up: released cash, not overspending.
  engine.drawFromFund(fx.ids.carFundId, {
    accountId: fx.ids.checkingId,
    kind: "EXPENSE",
    categoryId: fx.ids.carRepairId,
    amountCents: -45_000,
    date: "2026-06-20",
    payee: "Moe's Garage",
  });

  return { engine, fx };
}

describe("planned vs actual (month report)", () => {
  it("splits the month into saved, popped up, and went-as-planned", () => {
    const { engine, fx } = juneWithActivity();

    const report = engine.plannedVsActual(fx.ids.monthJunId);

    expect(report.categories).toEqual([
      {
        categoryId: fx.ids.groceriesId,
        plannedCents: 100_000,
        actualCents: 95_000,
        poppedUpCents: 0,
        ordinarySpentCents: 95_000,
        varianceCents: 5_000,
        verdict: "as-planned",
      },
      {
        categoryId: fx.ids.diningId,
        plannedCents: 50_000,
        actualCents: 60_000,
        poppedUpCents: 0,
        ordinarySpentCents: 60_000,
        varianceCents: -10_000,
        verdict: "overspent",
      },
      {
        categoryId: fx.ids.carRepairId,
        plannedCents: 20_000,
        actualCents: 45_000,
        poppedUpCents: 45_000,
        ordinarySpentCents: 0,
        varianceCents: 20_000,
        verdict: "saved",
      },
    ]);

    expect(report.plannedTotalCents).toBe(170_000);
    expect(report.actualTotalCents).toBe(200_000);
    // Saved counts only the saved verdict's unspent plan.
    expect(report.savedTotalCents).toBe(20_000);
    expect(report.overspentTotalCents).toBe(10_000);
    expect(report.asPlannedPlannedCents).toBe(100_000);
    expect(report.poppedUpTotalCents).toBe(45_000);
  });

  it("reports the pop-up draw with its fund and expense payee", () => {
    const { engine, fx } = juneWithActivity();

    const report = engine.plannedVsActual(fx.ids.monthJunId);

    expect(report.draws).toEqual([
      {
        drawId: expect.any(String),
        fundId: fx.ids.carFundId,
        fundName: "Car repair",
        fundKind: "SINKING",
        amountCents: 45_000,
        paidExpense: true,
        expensePayee: "Moe's Garage",
      },
    ]);
  });

  it("agrees with the month cashflow ledger it is built on", () => {
    const { engine, fx } = juneWithActivity();

    const report = engine.plannedVsActual(fx.ids.monthJunId);
    const cashflow = engine.monthCashflow(fx.ids.monthJunId);

    // Income 250,000 + draw 45,000 − spending 200,000 = 95,000. The draw
    // raises cashflow; the pop-up expense counts as spending, not as overspending.
    expect(cashflow.fundDrawCents).toBe(report.poppedUpTotalCents);
    expect(cashflow.incomeReceivedCents).toBe(report.incomeReceivedCents);
    expect(report.netCashflowCents).toBe(95_000);
  });

  it("marks spending with no plan as overspent", () => {
    const fx = buildFixture();
    const engine = createBudgetEngine(fx.state);
    engine.recordTransaction({
      accountId: fx.ids.checkingId,
      kind: "EXPENSE",
      categoryId: fx.ids.groceriesId,
      amountCents: -15_000,
      date: "2026-06-05",
      payee: "Supermarket",
    });

    const report = engine.plannedVsActual(fx.ids.monthJunId);

    expect(report.categories).toEqual([
      {
        categoryId: fx.ids.groceriesId,
        plannedCents: 0,
        actualCents: 15_000,
        poppedUpCents: 0,
        ordinarySpentCents: 15_000,
        varianceCents: -15_000,
        verdict: "overspent",
      },
    ]);
    expect(report.overspentTotalCents).toBe(15_000);
    expect(report.savedTotalCents).toBe(0);
  });

  it("honors a tighter as-planned band when asked", () => {
    const fx = buildFixture();
    const engine = createBudgetEngine(fx.state);
    engine.assign(fx.ids.monthJunId, fx.ids.groceriesId, 100_000);
    engine.recordTransaction({
      accountId: fx.ids.creditId,
      kind: "EXPENSE",
      categoryId: fx.ids.groceriesId,
      amountCents: -95_000,
      date: "2026-06-10",
      payee: "Supermarket",
    });

    // ±5,000 under a 10% band is as-planned; with a zero band it is saved.
    expect(
      engine.plannedVsActual(fx.ids.monthJunId).categories[0]?.verdict,
    ).toBe("as-planned");
    expect(
      engine.plannedVsActual(fx.ids.monthJunId, { asPlannedBandPercent: 0 })
        .categories[0]?.verdict,
    ).toBe("saved");
  });

  it("reports a static-goal draw as popped up without touching categories", () => {
    const fx = buildFixture();
    const engine = createBudgetEngine(fx.state);
    engine.drawFromStaticGoal(fx.ids.vacationFundId, 30_000, fx.ids.monthJunId);

    const report = engine.plannedVsActual(fx.ids.monthJunId);

    expect(report.draws).toEqual([
      {
        drawId: expect.any(String),
        fundId: fx.ids.vacationFundId,
        fundName: "Vacation",
        fundKind: "STATIC",
        amountCents: 30_000,
        paidExpense: false,
        expensePayee: undefined,
      },
    ]);
    expect(report.poppedUpTotalCents).toBe(30_000);
    // No companion category, no plan, no spending: no category rows at all.
    expect(report.categories).toEqual([]);
    expect(report.netCashflowCents).toBe(30_000);
  });

  it("is empty for a month with no plan, spending, or draws", () => {
    const fx = buildFixture();
    const engine = createBudgetEngine(fx.state);

    const report = engine.plannedVsActual(fx.ids.monthJulId);

    expect(report.categories).toEqual([]);
    expect(report.draws).toEqual([]);
    expect(report.plannedTotalCents).toBe(0);
    expect(report.savedTotalCents).toBe(0);
    expect(report.poppedUpTotalCents).toBe(0);
  });

  it("rejects an unknown month", () => {
    const fx = buildFixture();
    const engine = createBudgetEngine(fx.state);

    expect(errorOf(() => engine.plannedVsActual("m-nowhere")).code).toBe(
      "UNKNOWN_MONTH",
    );
  });
});
