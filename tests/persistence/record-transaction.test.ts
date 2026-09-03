import { beforeEach, describe, expect, it } from "vitest";

import {
  recordManualTransaction,
  type ManualTransactionInput,
} from "@/lib/repositories/transactions";

import {
  resetDatabase,
  seedHousehold,
  testDb,
  type SeededHousehold,
} from "./test-db";

let seeded: SeededHousehold;

beforeEach(async () => {
  await resetDatabase();
  seeded = await seedHousehold(`manual-entry-${crypto.randomUUID()}`);
});

function expenseInput(overrides: Partial<ManualTransactionInput> = {}) {
  return {
    accountId: seeded.accountIds.checking,
    kind: "EXPENSE" as const,
    amountCents: -2500,
    date: "2026-09-10",
    payee: "Corner Grocer",
    categoryId: seeded.categoryIds.groceries,
    ...overrides,
  };
}

describe("recordManualTransaction — persistence + recomputation (D4)", () => {
  it("persists the transaction and recomputes category availability from the database", async () => {
    const result = await recordManualTransaction(
      testDb,
      seeded.householdId,
      expenseInput(),
    );

    const rows = await testDb.transaction.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(result.transaction.id);
    expect(row.kind).toBe("EXPENSE");
    expect(row.amountCents).toBe(-2500);
    expect(row.categoryId).toBe(seeded.categoryIds.groceries);
    expect(row.payee).toBe("Corner Grocer");
    expect(row.reviewState).toBe("CONFIRMED");
    expect(row.pending).toBe(false);
    expect(row.date.toISOString().slice(0, 10)).toBe("2026-09-10");

    // Availability is recomputed by the engine over the month's ledger:
    // assigned (0) − spent (2500) = −2500.
    const groceries = result.categoryAvailability.find(
      (c) => c.categoryId === seeded.categoryIds.groceries,
    );
    expect(groceries).toMatchObject({
      assignedCents: 0,
      spentCents: 2500,
      cashflowReleasedCents: 0,
      availableCents: -2500,
    });

    // And a fresh hydration of the database agrees with the returned view.
    const { loadHouseholdEngineState } = await import(
      "@/lib/repositories/engine-state"
    );
    const { createBudgetEngine } = await import("@/src/engine");
    const engine = createBudgetEngine(
      await loadHouseholdEngineState(testDb, seeded.householdId),
    );
    expect(engine.categoryAvailable(result.monthId)).toEqual(
      result.categoryAvailability,
    );
  });

  it("raises Ready to Assign when income lands — and expenses never touch it", async () => {
    await recordManualTransaction(testDb, seeded.householdId, {
      accountId: seeded.accountIds.checking,
      kind: "INCOME",
      amountCents: 100000,
      date: "2026-09-01",
      payee: "Employer",
    });

    const state = await recordManualTransaction(
      testDb,
      seeded.householdId,
      expenseInput({
        amountCents: -1200,
        categoryId: seeded.categoryIds.diningOut,
      }),
    );

    // Engine Ready to Assign = income received − assigned (expected income is
    // planning metadata; actual entries move the number).
    expect(state.readyToAssignCents).toBe(100000);
  });

  it("lands CONFIRMED by default and NEEDS_REVIEW when flagged for the review queue", async () => {
    await recordManualTransaction(testDb, seeded.householdId, expenseInput());

    await recordManualTransaction(
      testDb,
      seeded.householdId,
      expenseInput({
        amountCents: -900,
        payee: "Mystery Charge",
        reviewState: "NEEDS_REVIEW",
      }),
    );

    const byState = await testDb.transaction.findMany({
      select: { payee: true, reviewState: true },
    });
    expect(byState).toContainEqual({
      payee: "Corner Grocer",
      reviewState: "CONFIRMED",
    });
    expect(byState).toContainEqual({
      payee: "Mystery Charge",
      reviewState: "NEEDS_REVIEW",
    });
  });

  it("supports pending entries (card spend that hasn't settled)", async () => {
    await recordManualTransaction(
      testDb,
      seeded.householdId,
      expenseInput({ accountId: seeded.accountIds.credit, pending: true }),
    );

    const row = await testDb.transaction.findFirstOrThrow();
    expect(row.pending).toBe(true);
    expect(row.accountId).toBe(seeded.accountIds.credit);
  });

  it("scaffolds the month when the entry is dated beyond the planned month", async () => {
    const result = await recordManualTransaction(testDb, seeded.householdId, {
      accountId: seeded.accountIds.checking,
      kind: "EXPENSE",
      amountCents: -4000,
      date: "2026-10-02",
      payee: "October Rent",
      categoryId: seeded.categoryIds.groceries,
    });

    const scaffolded = await testDb.month.findUniqueOrThrow({
      where: { id: result.monthId },
    });
    expect([scaffolded.year, scaffolded.month]).toEqual([2026, 10]);
    // Household's expected income carries into the scaffolded month.
    expect(scaffolded.expectedIncomeCents).toBe(400000);
  });

  it("rejects a duplicate externalId on the same account and persists nothing", async () => {
    await recordManualTransaction(
      testDb,
      seeded.householdId,
      expenseInput({ externalId: "feed-1" }),
    );

    await expect(
      recordManualTransaction(
        testDb,
        seeded.householdId,
        expenseInput({ externalId: "feed-1" }),
      ),
    ).rejects.toMatchObject({
      name: "EngineError",
      code: "DUPLICATE_EXTERNAL_ID",
    });

    expect(await testDb.transaction.count()).toBe(1);
  });

  it("never touches another household's accounts", async () => {
    const other = await seedHousehold(`other-${crypto.randomUUID()}`);

    await expect(
      recordManualTransaction(testDb, other.householdId, expenseInput()),
    ).rejects.toMatchObject({ name: "EngineError", code: "UNKNOWN_ACCOUNT" });

    // A foreign category is equally out of reach.
    await expect(
      recordManualTransaction(
        testDb,
        other.householdId,
        expenseInput({ accountId: other.accountIds.checking }),
      ),
    ).rejects.toMatchObject({ name: "EngineError", code: "UNKNOWN_CATEGORY" });

    expect(await testDb.transaction.count()).toBe(0);
  });
});
