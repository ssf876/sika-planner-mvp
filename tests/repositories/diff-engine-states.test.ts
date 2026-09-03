import { describe, expect, it } from "vitest";

import { createBudgetEngine, type EngineState } from "@/src/engine";

import { diffEngineStates } from "@/lib/repositories/engine-state";

const BASE_STATE: EngineState = {
  householdId: "h1",
  accounts: [
    {
      id: "a1",
      householdId: "h1",
      kind: "CHECKING",
      name: "Everyday",
      startingCents: 100000,
    },
    { id: "a2", householdId: "h1", kind: "CASH", name: "Wallet", startingCents: 0 },
  ],
  categories: [
    { id: "c1", householdId: "h1", group: "NEEDS", name: "Groceries" },
    // Sinking funds post draws against a companion category (engine rule).
    {
      id: "c2",
      householdId: "h1",
      group: "NEEDS",
      name: "Car repair",
      fundId: "f1",
    },
  ],
  months: [
    { id: "m1", householdId: "h1", year: 2026, month: 9, expectedIncomeCents: 0 },
  ],
  allocations: [{ monthId: "m1", categoryId: "c1", assignedCents: 5000 }],
  transactions: [
    {
      id: "t1",
      accountId: "a1",
      categoryId: "c1",
      kind: "EXPENSE",
      amountCents: -1000,
      date: "2026-09-10",
      payee: "Existing",
      pending: false,
      reviewState: "CONFIRMED",
    },
  ],
  funds: [
    {
      id: "f1",
      householdId: "h1",
      kind: "SINKING",
      name: "Car repair",
      balanceCents: 20000,
    },
  ],
  fundDraws: [],
  transfers: [],
};

describe("diffEngineStates — one engine op → exact writes", () => {
  it("returns an empty delta for identical states", () => {
    expect(diffEngineStates(BASE_STATE, structuredClone(BASE_STATE))).toEqual({
      transactionsToCreate: [],
      fundDrawsToCreate: [],
      transfersToCreate: [],
      fundBalanceUpdates: [],
      allocationUpserts: [],
      allocationDeletes: [],
    });
  });

  it("detects a new transaction, not the pre-existing rows", () => {
    const before = structuredClone(BASE_STATE);
    const engine = createBudgetEngine(before);
    engine.recordTransaction({
      accountId: "a1",
      kind: "EXPENSE",
      amountCents: -2500,
      date: "2026-09-11",
      payee: "New",
      categoryId: "c1",
    });
    const after = engine.snapshot();

    const delta = diffEngineStates(before, after);
    expect(delta.transactionsToCreate).toHaveLength(1);
    expect(delta.transactionsToCreate[0].payee).toBe("New");
    expect(delta.fundBalanceUpdates).toEqual([]);
  });

  it("detects a new transfer (ATM withdrawal path)", () => {
    const before = structuredClone(BASE_STATE);
    const engine = createBudgetEngine(before);
    engine.withdrawToCash("a1", 3000, "2026-09-12");
    const after = engine.snapshot();

    const delta = diffEngineStates(before, after);
    expect(delta.transfersToCreate).toHaveLength(1);
    expect(delta.transfersToCreate[0]).toMatchObject({
      fromAccountId: "a1",
      toAccountId: "a2",
      amountCents: 3000,
    });
  });

  it("detects a new fund draw and the fund balance adjustment", () => {
    const before = structuredClone(BASE_STATE);
    const engine = createBudgetEngine(before);
    engine.drawFromFund("f1", {
      accountId: "a1",
      kind: "EXPENSE",
      amountCents: -5000,
      date: "2026-09-13",
      payee: "Mechanic",
    });
    const after = engine.snapshot();

    const delta = diffEngineStates(before, after);
    expect(delta.fundDrawsToCreate).toHaveLength(1);
    expect(delta.fundDrawsToCreate[0].amountCents).toBe(5000);
    expect(delta.fundBalanceUpdates).toEqual([
      { id: "f1", balanceCents: 15000 },
    ]);
    // The draw also paid an expense transaction.
    expect(delta.transactionsToCreate).toHaveLength(1);
  });

  it("detects an allocation changed in place", () => {
    const before = structuredClone(BASE_STATE);
    const engine = createBudgetEngine(before);
    engine.assign("m1", "c1", 8000);
    const after = engine.snapshot();

    const delta = diffEngineStates(before, after);
    expect(delta.allocationUpserts).toEqual([
      { monthId: "m1", categoryId: "c1", assignedCents: 8000 },
    ]);
    expect(delta.allocationDeletes).toEqual([]);
  });

  it("detects an allocation deletion when an op zeroes the only assignment", () => {
    const before = structuredClone(BASE_STATE);
    const engine = createBudgetEngine(before);
    engine.assign("m1", "c1", 0);
    const after = engine.snapshot();

    const delta = diffEngineStates(before, after);
    expect(delta.allocationUpserts).toEqual([]);
    expect(delta.allocationDeletes).toEqual([
      { monthId: "m1", categoryId: "c1" },
    ]);
  });
});
