import { describe, expect, it } from "vitest";

import { createBudgetEngine } from "@/src/engine";
import type { ConfirmedLifeEvent } from "@/src/engine/types";

import { buildFixture, type Fixture } from "./fixtures";

// Annual summary (D9): the year's months aggregated — savings rate, net-worth
// trend, major pop-up life events, confirmed seasons. Every scenario drives
// real engine ops across multiple months, so the aggregation can never drift
// from the month reports it is built from.

type Engine = ReturnType<typeof createBudgetEngine>;

/** June 2026 with income, a three-category plan, mixed spending, and a pop-up. */
function runJune(engine: Engine, fx: Fixture): void {
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

  // Groceries inside the ±10% band → as-planned. Dining past the band → overspent.
  engine.recordTransaction({
    accountId: fx.ids.creditId,
    kind: "EXPENSE",
    categoryId: fx.ids.groceriesId,
    amountCents: -95_000,
    date: "2026-06-10",
    payee: "Supermarket",
  });
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
  // Moving money between the household's own accounts never changes net worth.
  engine.recordTransfer({
    fromAccountId: fx.ids.checkingId,
    toAccountId: fx.ids.cashId,
    amountCents: 10_000,
    date: "2026-06-15",
    payee: "Cash run",
  });
}

/** July 2026 with income, one planned category coming in under, and a static draw. */
function runJuly(engine: Engine, fx: Fixture): void {
  engine.recordTransaction({
    accountId: fx.ids.checkingId,
    kind: "INCOME",
    amountCents: 250_000,
    date: "2026-07-01",
    payee: "Paycheck",
  });
  engine.assign(fx.ids.monthJulId, fx.ids.diningId, 40_000);
  engine.recordTransaction({
    accountId: fx.ids.creditId,
    kind: "EXPENSE",
    categoryId: fx.ids.diningId,
    amountCents: -30_000,
    date: "2026-07-08",
    payee: "Sushi bar",
  });
  // A big static-goal draw — a life-event pop-up in the annual view. Static
  // draws release cash (ledger inflow) without an expense transaction.
  engine.drawFromStaticGoal(fx.ids.vacationFundId, 120_000, fx.ids.monthJulId);
}

/** June + July 2026 fully populated; nothing in the rest of the year. */
function yearWithTwoActiveMonths(): { engine: Engine; fx: Fixture } {
  const fx = buildFixture();
  const engine = createBudgetEngine(fx.state);
  runJune(engine, fx);
  runJuly(engine, fx);
  return { engine, fx };
}

describe("annual summary", () => {
  it("aggregates the year's months into totals and a savings rate", () => {
    const { engine } = yearWithTwoActiveMonths();

    const summary = engine.annualSummary(2026);

    expect(summary.year).toBe(2026);
    expect(summary.months.map((m) => m.month)).toEqual([6, 7]);
    // June: 250k income + 45k pop-up inflow − 200k spending = 95k net.
    expect(summary.months[0]).toMatchObject({
      incomeReceivedCents: 250_000,
      poppedUpCents: 45_000,
      spendingCents: 200_000,
      netCashflowCents: 95_000,
      // The car-repair plan the pop-up draw absorbed counts as saved; the
      // repair itself reports under popped up (same convention as the month).
      savedCents: 20_000,
      overspentCents: 10_000,
    });
    // July: 250k income + 120k draw inflow − 30k spending = 340k net.
    expect(summary.months[1]).toMatchObject({
      incomeReceivedCents: 250_000,
      poppedUpCents: 120_000,
      spendingCents: 30_000,
      netCashflowCents: 340_000,
      savedCents: 10_000,
      overspentCents: 0,
    });

    expect(summary.totalIncomeCents).toBe(500_000);
    expect(summary.totalPoppedUpCents).toBe(165_000);
    expect(summary.totalSpendingCents).toBe(230_000);
    expect(summary.totalSavedCents).toBe(30_000);
    expect(summary.totalOverspentCents).toBe(10_000);
    // Inflows 665k, net 435k → 65.41…% floored.
    expect(summary.savingsRatePercent).toBe(65);
  });

  it("tracks net worth as starting balances plus signed activity, transfers neutral", () => {
    const { engine } = yearWithTwoActiveMonths();

    const summary = engine.annualSummary(2026);
    const byMonth = new Map(
      summary.netWorthTrend.map((point) => [point.month, point.netWorthCents]),
    );

    // 12 calendar points; months 1–5 carry the untouched starting balance.
    expect(summary.netWorthTrend).toHaveLength(12);
    expect(summary.netWorthTrend[0].label).toBe("January 2026");
    expect(byMonth.get(5)).toBe(105_000);
    // June: +250k income −95k −60k −45k pop-up; the 10k transfer nets out.
    expect(byMonth.get(6)).toBe(155_000);
    // July: +250k income −30k; the static draw moves no account money.
    expect(byMonth.get(7)).toBe(375_000);
    expect(byMonth.get(12)).toBe(375_000);
  });

  it("lists major pop-ups at or above the threshold, largest first", () => {
    const { engine } = yearWithTwoActiveMonths();

    const defaultThreshold = engine.annualSummary(2026);
    expect(defaultThreshold.majorPopUps).toHaveLength(1);
    expect(defaultThreshold.majorPopUps[0]).toMatchObject({
      fundName: "Vacation",
      amountCents: 120_000,
      monthLabel: "July 2026",
    });

    // Lowering the threshold lets the June car repair join, ranked by size.
    const lowered = engine.annualSummary(2026, {
      majorPopUpThresholdCents: 40_000,
    });
    expect(lowered.majorPopUps).toHaveLength(2);
    expect(lowered.majorPopUps.map((row) => row.fundName)).toEqual([
      "Vacation",
      "Car repair",
    ]);
  });

  it("carries confirmed seasons starting in the year, chronological", () => {
    const { engine } = yearWithTwoActiveMonths();

    const events: ConfirmedLifeEvent[] = [
      { id: "le-wedding", kind: "WEDDING", seasonStart: "2025-08-01" },
      { id: "le-home", kind: "HOME_PURCHASE", seasonStart: "2026-03-15" },
      { id: "le-move", kind: "MOVE", seasonStart: "2026-08-02" },
    ];
    const summary = engine.annualSummary(2026, { confirmedLifeEvents: events });

    // Only seasons that START in 2026, ordered by season start.
    expect(summary.confirmedSeasons.map((event) => event.id)).toEqual([
      "le-home",
      "le-move",
    ]);
  });

  it("returns a null savings rate and a flat trend for an empty year", () => {
    const fx = buildFixture();
    const engine = createBudgetEngine(fx.state);

    const summary = engine.annualSummary(2027);

    expect(summary.months).toEqual([]);
    expect(summary.savingsRatePercent).toBeNull();
    expect(summary.totalIncomeCents).toBe(0);
    expect(summary.netWorthTrend).toHaveLength(12);
    for (const point of summary.netWorthTrend) {
      expect(point.netWorthCents).toBe(105_000);
    }
    expect(summary.majorPopUps).toEqual([]);
    expect(summary.confirmedSeasons).toEqual([]);
  });
});
