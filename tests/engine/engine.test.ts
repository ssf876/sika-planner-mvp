import { describe, expect, it } from "vitest";
import { createBudgetEngine, EngineError } from "@/src/engine";
import { buildFixture, type Fixture } from "./fixtures";

type Engine = ReturnType<typeof createBudgetEngine>;

function engineWithIds() {
  const fx = buildFixture();
  return { engine: createBudgetEngine(fx.state), fx };
}

function errorOf(run: () => unknown): EngineError {
  try {
    run();
    return expect.unreachable("expected EngineError");
  } catch (error) {
    if (!(error instanceof EngineError)) throw error;
    return error;
  }
}

describe("zero-based planning (Ready to Assign)", () => {
  it("is detectable: assign exactly the income received and Ready to Assign lands at 0", () => {
    const { engine, fx } = engineWithIds();
    engine.recordTransaction({
      accountId: fx.ids.checkingId,
      kind: "INCOME",
      amountCents: 300_000,
      date: "2026-06-01",
      payee: "Paycheck",
    });
    engine.assign(fx.ids.monthJunId, fx.ids.groceriesId, 120_000);
    engine.assign(fx.ids.monthJunId, fx.ids.diningId, 95_000);
    engine.assign(fx.ids.monthJunId, fx.ids.carRepairId, 85_000);
    expect(engine.readyToAssignCents(fx.ids.monthJunId)).toBe(0);
  });

  it("goes negative when over-assigned and recovers when corrected", () => {
    const { engine, fx } = engineWithIds();
    engine.recordTransaction({
      accountId: fx.ids.checkingId,
      kind: "INCOME",
      amountCents: 300_000,
      date: "2026-06-01",
      payee: "Paycheck",
    });
    engine.assign(fx.ids.monthJunId, fx.ids.groceriesId, 350_000);
    expect(engine.readyToAssignCents(fx.ids.monthJunId)).toBe(-50_000);
    // Assigning again replaces the value — one allocation per month+category.
    engine.assign(fx.ids.monthJunId, fx.ids.groceriesId, 300_000);
    expect(engine.readyToAssignCents(fx.ids.monthJunId)).toBe(0);
    expect(engine.allocationsOf(fx.ids.monthJunId)).toHaveLength(1);
  });

  it("counts only real income transactions, not expected income", () => {
    const { engine, fx } = engineWithIds();
    // expectedIncomeCents is plan metadata; the engine tracks money actually received.
    expect(engine.readyToAssignCents(fx.ids.monthJunId)).toBe(0);
    engine.assign(fx.ids.monthJunId, fx.ids.groceriesId, 100);
    expect(engine.readyToAssignCents(fx.ids.monthJunId)).toBe(-100);
  });

  it("assign 0 unassigns", () => {
    const { engine, fx } = engineWithIds();
    engine.assign(fx.ids.monthJunId, fx.ids.groceriesId, 120_000);
    engine.assign(fx.ids.monthJunId, fx.ids.groceriesId, 0);
    expect(engine.allocationsOf(fx.ids.monthJunId)).toHaveLength(0);
    expect(
      engine
        .categoryAvailable(fx.ids.monthJunId)
        .find((c) => c.categoryId === fx.ids.groceriesId)?.assignedCents,
    ).toBe(0);
  });

  it("copyPreviousMonth starts this month from last month, then lets you edit", () => {
    const { engine, fx } = engineWithIds();
    engine.assign(fx.ids.monthJunId, fx.ids.groceriesId, 120_000);
    engine.assign(fx.ids.monthJunId, fx.ids.carRepairId, 30_000);

    engine.copyPreviousMonth(fx.ids.monthJulId);
    expect(engine.allocationsOf(fx.ids.monthJulId)).toEqual([
      {
        monthId: fx.ids.monthJulId,
        categoryId: fx.ids.groceriesId,
        assignedCents: 120_000,
      },
      {
        monthId: fx.ids.monthJulId,
        categoryId: fx.ids.carRepairId,
        assignedCents: 30_000,
      },
    ]);

    // Then edit: July's change leaves June alone.
    engine.assign(fx.ids.monthJulId, fx.ids.groceriesId, 135_000);
    expect(
      engine
        .allocationsOf(fx.ids.monthJunId)
        .find((a) => a.categoryId === fx.ids.groceriesId)?.assignedCents,
    ).toBe(120_000);
    expect(
      engine
        .allocationsOf(fx.ids.monthJulId)
        .find((a) => a.categoryId === fx.ids.groceriesId)?.assignedCents,
    ).toBe(135_000);
  });

  it("copyPreviousMonth requires the previous month to exist", () => {
    const { engine, fx } = engineWithIds();
    // June 2026's previous month is May 2026, which doesn't exist.
    expect(
      errorOf(() => engine.copyPreviousMonth(fx.ids.monthJunId)).code,
    ).toBe("PREVIOUS_MONTH_MISSING");
  });
});

describe("input validation", () => {
  it.each([
    [
      "assign a fractional amount",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.assign(fx.ids.monthJunId, fx.ids.groceriesId, 100.5);
      },
      "NOT_INTEGER_CENTS",
    ],
    [
      "assign a negative amount",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.assign(fx.ids.monthJunId, fx.ids.groceriesId, -1);
      },
      "NEGATIVE_ASSIGNMENT",
    ],
    [
      "record a fractional transaction",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.recordTransaction({
          accountId: fx.ids.checkingId,
          kind: "INCOME",
          amountCents: 0.1,
          date: "2026-06-01",
          payee: "x",
        });
      },
      "NOT_INTEGER_CENTS",
    ],
    [
      "record a zero-amount transaction",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.recordTransaction({
          accountId: fx.ids.checkingId,
          kind: "INCOME",
          amountCents: 0,
          date: "2026-06-01",
          payee: "x",
        });
      },
      "ZERO_AMOUNT",
    ],
    [
      "record income with a category",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.recordTransaction({
          accountId: fx.ids.checkingId,
          kind: "INCOME",
          amountCents: 1,
          categoryId: fx.ids.groceriesId,
          date: "2026-06-01",
          payee: "x",
        });
      },
      "INCOME_HAS_NO_CATEGORY",
    ],
    [
      "record an expense without a category",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.recordTransaction({
          accountId: fx.ids.checkingId,
          kind: "EXPENSE",
          amountCents: -100,
          date: "2026-06-01",
          payee: "x",
        });
      },
      "CATEGORY_REQUIRED",
    ],
    [
      "record TRANSFER kind through recordTransaction",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.recordTransaction({
          accountId: fx.ids.checkingId,
          kind: "TRANSFER",
          amountCents: -100,
          date: "2026-06-01",
          payee: "x",
        });
      },
      "TRANSFER_KIND_UNSUPPORTED",
    ],
    [
      "record against an unknown account",
      ({ engine }: { engine: Engine; fx: Fixture }) => {
        engine.recordTransaction({
          accountId: "nope",
          kind: "INCOME",
          amountCents: 100,
          date: "2026-06-01",
          payee: "x",
        });
      },
      "UNKNOWN_ACCOUNT",
    ],
    [
      "record outside any known month",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.recordTransaction({
          accountId: fx.ids.checkingId,
          kind: "INCOME",
          amountCents: 100,
          date: "2026-08-01",
          payee: "x",
        });
      },
      "UNKNOWN_MONTH",
    ],
    [
      "assign to an unknown month",
      ({ engine }: { engine: Engine; fx: Fixture }) => {
        engine.assign("nope", "cat", 100);
      },
      "UNKNOWN_MONTH",
    ],
    [
      "assign to an unknown category",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.assign(fx.ids.monthJunId, "nope", 100);
      },
      "UNKNOWN_CATEGORY",
    ],
    [
      "withdraw a non-integer amount",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.withdrawToCash(fx.ids.checkingId, 20.5);
      },
      "NOT_INTEGER_CENTS",
    ],
    [
      "withdraw a non-positive amount",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.withdrawToCash(fx.ids.checkingId, 0);
      },
      "NON_POSITIVE_CENTS",
    ],
    [
      "withdraw from the cash wallet itself",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.withdrawToCash(fx.ids.cashId, 100);
      },
      "SELF_TRANSFER",
    ],
    [
      "draw a sinking fund with a positive (money-in) expense",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.drawFromFund(fx.ids.carFundId, {
          accountId: fx.ids.checkingId,
          kind: "EXPENSE",
          amountCents: 500,
          date: "2026-06-01",
          payee: "x",
        });
      },
      "INVALID_EXPENSE_AMOUNT",
    ],
    [
      "draw a sinking fund against a non-companion category",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.drawFromFund(fx.ids.carFundId, {
          accountId: fx.ids.checkingId,
          categoryId: fx.ids.groceriesId,
          kind: "EXPENSE",
          amountCents: -500,
          date: "2026-06-01",
          payee: "x",
        });
      },
      "CATEGORY_MISMATCH",
    ],
    [
      "drawFromFund on a static fund",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.drawFromFund(fx.ids.vacationFundId, {
          accountId: fx.ids.checkingId,
          kind: "EXPENSE",
          amountCents: -500,
          date: "2026-06-01",
          payee: "x",
        });
      },
      "FUND_KIND_MISMATCH",
    ],
    [
      "drawFromStaticGoal on a sinking fund",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.drawFromStaticGoal(fx.ids.carFundId, 500, fx.ids.monthJunId);
      },
      "FUND_KIND_MISMATCH",
    ],
    [
      "drawFromStaticGoal a fractional amount",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.drawFromStaticGoal(
          fx.ids.vacationFundId,
          40.25,
          fx.ids.monthJunId,
        );
      },
      "NOT_INTEGER_CENTS",
    ],
    [
      "drawFromStaticGoal an unknown month",
      ({ engine, fx }: { engine: Engine; fx: Fixture }) => {
        engine.drawFromStaticGoal(fx.ids.vacationFundId, 100, "nope");
      },
      "UNKNOWN_MONTH",
    ],
    [
      "read an unknown fund",
      ({ engine }: { engine: Engine; fx: Fixture }) => {
        engine.fundBalanceCents("nope");
      },
      "UNKNOWN_FUND",
    ],
  ])("rejects %s with %s", (_label, trigger, expectedCode) => {
    const { engine, fx } = engineWithIds();
    expect(errorOf(() => trigger({ engine, fx })).code).toBe(expectedCode);
  });

  it("treats a repeated (accountId, externalId) as an idempotent re-import", () => {
    const { engine, fx } = engineWithIds();
    const tx = {
      accountId: fx.ids.checkingId,
      kind: "INCOME" as const,
      amountCents: 250_000,
      date: "2026-06-15",
      payee: "Paycheck",
      externalId: "csv-row-42",
    };
    engine.recordTransaction(tx);
    expect(errorOf(() => engine.recordTransaction(tx)).code).toBe(
      "DUPLICATE_EXTERNAL_ID",
    );
    expect(engine.snapshot().transactions).toHaveLength(1);
    expect(engine.readyToAssignCents(fx.ids.monthJunId)).toBe(250_000);
  });

  it("requires a cash account for withdrawToCash", () => {
    const fx = buildFixture();
    fx.state.accounts = fx.state.accounts.filter((a) => a.kind !== "CASH");
    const engine = createBudgetEngine(fx.state);
    expect(
      errorOf(() => engine.withdrawToCash(fx.ids.checkingId, 100)).code,
    ).toBe("NO_CASH_ACCOUNT");
  });

  it("requires a companion category for drawFromFund", () => {
    const fx = buildFixture();
    fx.state.categories = fx.state.categories.filter(
      (c) => c.id !== fx.ids.carRepairId,
    );
    const engine = createBudgetEngine(fx.state);
    expect(
      errorOf(() =>
        engine.drawFromFund(fx.ids.carFundId, {
          accountId: fx.ids.checkingId,
          kind: "EXPENSE",
          amountCents: -500,
          date: "2026-06-01",
          payee: "x",
        }),
      ).code,
    ).toBe("COMPANION_CATEGORY_REQUIRED");
  });
});
