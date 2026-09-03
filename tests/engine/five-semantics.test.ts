import { describe, expect, it } from "vitest";
import { createBudgetEngine, type BudgetEngineRuntime } from "@/src/engine";
import { buildFixture, type Fixture } from "./fixtures";

// The five money semantics (spec: "Five rules make 'available' tell the truth"),
// enforced as executable fact. One table row per rule; every row starts from
// the same deterministic household and asserts what each event may and may not
// move.

interface Scenario {
  name: string;
  run: (engine: BudgetEngineRuntime, fx: Fixture) => void;
}

const scenarios: Scenario[] = [
  {
    name: "income received: lands in Ready to Assign, touches no category",
    run: (engine, fx) => {
      const before = engine.categoryAvailable(fx.ids.monthJunId);

      engine.recordTransaction({
        accountId: fx.ids.checkingId,
        kind: "INCOME",
        amountCents: 250_000,
        date: "2026-06-15",
        payee: "Paycheck",
      });

      expect(engine.readyToAssignCents(fx.ids.monthJunId)).toBe(250_000);
      expect(engine.categoryAvailable(fx.ids.monthJunId)).toEqual(before);
      expect(engine.accountBalanceCents(fx.ids.checkingId)).toBe(350_000);
    },
  },
  {
    name: "card purchase: depletes the category immediately, even while pending",
    run: (engine, fx) => {
      engine.recordTransaction({
        accountId: fx.ids.checkingId,
        kind: "INCOME",
        amountCents: 40_000,
        date: "2026-06-01",
        payee: "Paycheck",
      });
      engine.assign(fx.ids.monthJunId, fx.ids.groceriesId, 40_000);
      expect(engine.readyToAssignCents(fx.ids.monthJunId)).toBe(0);

      const returned = engine.recordTransaction({
        accountId: fx.ids.creditId,
        categoryId: fx.ids.groceriesId,
        kind: "EXPENSE",
        amountCents: -12_500,
        date: "2026-06-10",
        payee: "Supermarket",
        pending: true, // settles when the bill is paid — the category cannot wait
      });

      const groceries = returned.find(
        (c) => c.categoryId === fx.ids.groceriesId,
      );
      expect(groceries).toMatchObject({
        assignedCents: 40_000,
        spentCents: 12_500,
        availableCents: 27_500,
      });
      expect(engine.accountBalanceCents(fx.ids.creditId)).toBe(-12_500);
      expect(engine.accountBalanceCents(fx.ids.checkingId)).toBe(140_000); // 100k starting + 40k income; the card settles later
      // Spending counts at transaction time, not settlement time.
      expect(engine.monthCashflow(fx.ids.monthJunId).spendingCents).toBe(
        12_500,
      );
      expect(engine.readyToAssignCents(fx.ids.monthJunId)).toBe(0);
    },
  },
  {
    name: "credit card payment: moves two accounts, zero categories, zero new spending",
    run: (engine, fx) => {
      engine.recordTransaction({
        accountId: fx.ids.creditId,
        categoryId: fx.ids.groceriesId,
        kind: "EXPENSE",
        amountCents: -12_500,
        date: "2026-06-10",
        payee: "Supermarket",
        pending: true,
      });
      const availableAfterPurchase = engine
        .categoryAvailable(fx.ids.monthJunId)
        .find((c) => c.categoryId === fx.ids.groceriesId);
      const cashflowAfterPurchase = engine.monthCashflow(fx.ids.monthJunId);

      engine.recordTransfer({
        fromAccountId: fx.ids.checkingId,
        toAccountId: fx.ids.creditId,
        amountCents: 12_500,
        date: "2026-07-01",
        payee: "Credit card payment",
      });

      expect(engine.accountBalanceCents(fx.ids.checkingId)).toBe(87_500);
      expect(engine.accountBalanceCents(fx.ids.creditId)).toBe(0);
      // Already spent — a payment is not new spending and moves no category.
      expect(
        engine
          .categoryAvailable(fx.ids.monthJunId)
          .find((c) => c.categoryId === fx.ids.groceriesId),
      ).toEqual(availableAfterPurchase);
      expect(engine.monthCashflow(fx.ids.monthJunId)).toEqual(
        cashflowAfterPurchase,
      );
    },
  },
  {
    name: "ATM withdrawal: a transfer — zero categories, zero cashflow",
    run: (engine, fx) => {
      const categoriesBefore = engine.categoryAvailable(fx.ids.monthJunId);
      const cashflowBefore = engine.monthCashflow(fx.ids.monthJunId);

      const transferId = engine.withdrawToCash(
        fx.ids.checkingId,
        20_000,
        "2026-06-20",
      );

      expect(typeof transferId).toBe("string");
      expect(engine.accountBalanceCents(fx.ids.checkingId)).toBe(80_000);
      expect(engine.accountBalanceCents(fx.ids.cashId)).toBe(25_000);
      expect(engine.categoryAvailable(fx.ids.monthJunId)).toEqual(
        categoriesBefore,
      );
      expect(engine.monthCashflow(fx.ids.monthJunId)).toEqual(cashflowBefore);
      // The later cash spend is what hits the category — the withdrawal never does.
      engine.recordTransaction({
        accountId: fx.ids.cashId,
        categoryId: fx.ids.diningId,
        kind: "EXPENSE",
        amountCents: -4_500,
        date: "2026-06-21",
        payee: "Taco truck",
      });
      expect(
        engine
          .categoryAvailable(fx.ids.monthJunId)
          .find((c) => c.categoryId === fx.ids.diningId)?.spentCents,
      ).toBe(4_500);
    },
  },
  {
    name: "sinking-fund pop-up: fund −, expense posts, month cashflow rises as income — never Ready to Assign",
    run: (engine, fx) => {
      engine.recordTransaction({
        accountId: fx.ids.checkingId,
        kind: "INCOME",
        amountCents: 30_000,
        date: "2026-06-01",
        payee: "Paycheck",
      });
      engine.assign(fx.ids.monthJunId, fx.ids.carRepairId, 30_000);
      expect(engine.readyToAssignCents(fx.ids.monthJunId)).toBe(0);

      const drawId = engine.drawFromFund(fx.ids.carFundId, {
        accountId: fx.ids.checkingId,
        kind: "EXPENSE",
        amountCents: -45_000,
        date: "2026-06-18",
        payee: "Brake job",
      });

      expect(typeof drawId).toBe("string");
      expect(engine.fundBalanceCents(fx.ids.carFundId)).toBe(5_000);
      // Expense posts against the fund's companion category; the draw releases
      // the cash back — the fund absorbed the hit, so availability holds.
      const carRepair = engine
        .categoryAvailable(fx.ids.monthJunId)
        .find((c) => c.categoryId === fx.ids.carRepairId);
      expect(carRepair).toMatchObject({
        assignedCents: 30_000,
        spentCents: 45_000,
        cashflowReleasedCents: 45_000,
        availableCents: 30_000,
      });
      // Counts as that month's income (popped-up cashflow row)...
      const cashflow = engine.monthCashflow(fx.ids.monthJunId);
      expect(cashflow.fundDrawCents).toBe(45_000);
      expect(cashflow.incomeReceivedCents).toBe(30_000);
      expect(cashflow.spendingCents).toBe(45_000);
      expect(cashflow.netCashflowCents).toBe(30_000);
      // ...but never as paycheck income: Ready to Assign does not move.
      expect(engine.readyToAssignCents(fx.ids.monthJunId)).toBe(0);
      // The draw is linked to the expense transaction it paid.
      const expense = engine
        .snapshot()
        .transactions.find((t) => t.fundDrawId === drawId);
      expect(expense).toMatchObject({
        kind: "EXPENSE",
        categoryId: fx.ids.carRepairId,
        amountCents: -45_000,
      });
    },
  },
  {
    name: "static goal: stays put through every event, moves only on an explicit draw",
    run: (engine, fx) => {
      // Hammer every other op; the static fund must not flinch.
      engine.recordTransaction({
        accountId: fx.ids.checkingId,
        kind: "INCOME",
        amountCents: 60_000,
        date: "2026-06-01",
        payee: "Paycheck",
      });
      engine.recordTransaction({
        accountId: fx.ids.creditId,
        categoryId: fx.ids.groceriesId,
        kind: "EXPENSE",
        amountCents: -9_000,
        date: "2026-06-05",
        payee: "Supermarket",
      });
      engine.withdrawToCash(fx.ids.checkingId, 15_000, "2026-06-06");
      engine.drawFromFund(fx.ids.carFundId, {
        accountId: fx.ids.checkingId,
        kind: "EXPENSE",
        amountCents: -45_000,
        date: "2026-06-18",
        payee: "Brake job",
      });
      expect(engine.fundBalanceCents(fx.ids.vacationFundId)).toBe(120_000);

      const drawId = engine.drawFromStaticGoal(
        fx.ids.vacationFundId,
        40_000,
        fx.ids.monthJulId,
      );

      expect(typeof drawId).toBe("string");
      expect(engine.fundBalanceCents(fx.ids.vacationFundId)).toBe(80_000);
      // The draw shows as popped-up cashflow in the month it was drawn.
      expect(engine.monthCashflow(fx.ids.monthJulId).fundDrawCents).toBe(
        40_000,
      );
      expect(engine.readyToAssignCents(fx.ids.monthJulId)).toBe(0);
      // And no category moved: static draws are uncoupled from categories.
      expect(
        engine
          .categoryAvailable(fx.ids.monthJulId)
          .every((c) => c.spentCents === 0 && c.cashflowReleasedCents === 0),
      ).toBe(true);
    },
  },
];

describe("the five money semantics", () => {
  it.each(scenarios)("$name", ({ run }) => {
    const fx = buildFixture();
    const engine = createBudgetEngine(fx.state);
    run(engine, fx);
  });

  it("leaves the caller's state untouched — the engine owns a private copy", () => {
    const fx = buildFixture();
    const engine = createBudgetEngine(fx.state);
    engine.recordTransaction({
      accountId: fx.ids.creditId,
      categoryId: fx.ids.groceriesId,
      kind: "EXPENSE",
      amountCents: -1_000,
      date: "2026-06-10",
      payee: "Supermarket",
    });
    expect(fx.state.transactions).toHaveLength(0);
    expect(
      fx.state.funds.find((f) => f.id === fx.ids.carFundId)?.balanceCents,
    ).toBe(50_000);
  });
});
