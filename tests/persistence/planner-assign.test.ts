import { beforeEach, describe, expect, it } from "vitest";

import {
  assignToCategory,
  copyPreviousMonthPlan,
  getPlannerSnapshot,
} from "@/lib/repositories/planner";

import {
  resetDatabase,
  seedHousehold,
  testDb,
  type SeededHousehold,
} from "./test-db";

let seeded: SeededHousehold;

beforeEach(async () => {
  await resetDatabase();
  seeded = await seedHousehold(`planner-${crypto.randomUUID()}`);
});

/** Create the August month with allocations, so September can copy it. */
async function seedPreviousMonth() {
  const august = await testDb.month.create({
    data: {
      householdId: seeded.householdId,
      year: 2026,
      month: 8,
      expectedIncomeCents: 400000,
    },
  });
  await testDb.allocation.createMany({
    data: [
      {
        monthId: august.id,
        categoryId: seeded.categoryIds.groceries,
        assignedCents: 25000,
      },
      {
        monthId: august.id,
        categoryId: seeded.categoryIds.diningOut,
        assignedCents: 7500,
      },
    ],
  });
  return august;
}

describe("assignToCategory — one assignment through the engine (D6)", () => {
  it("persists the allocation and returns the engine's recomputed view", async () => {
    const result = await assignToCategory(testDb, seeded.householdId, {
      monthId: seeded.monthId,
      categoryId: seeded.categoryIds.groceries,
      cents: 25000,
    });

    const row = await testDb.allocation.findUniqueOrThrow({
      where: {
        monthId_categoryId: {
          monthId: seeded.monthId,
          categoryId: seeded.categoryIds.groceries,
        },
      },
    });
    expect(row.assignedCents).toBe(25000);

    // No income transactions yet: RTA = 0 received − 250 assigned.
    expect(result.readyToAssignCents).toBe(-25000);
    const groceries = result.availability.find(
      (a) => a.categoryId === seeded.categoryIds.groceries,
    );
    expect(groceries).toMatchObject({
      assignedCents: 25000,
      spentCents: 0,
      availableCents: 25000,
    });
  });

  it("unassigns by writing zero through the same engine path", async () => {
    await assignToCategory(testDb, seeded.householdId, {
      monthId: seeded.monthId,
      categoryId: seeded.categoryIds.groceries,
      cents: 25000,
    });

    const result = await assignToCategory(testDb, seeded.householdId, {
      monthId: seeded.monthId,
      categoryId: seeded.categoryIds.groceries,
      cents: 0,
    });

    const row = await testDb.allocation.findUnique({
      where: {
        monthId_categoryId: {
          monthId: seeded.monthId,
          categoryId: seeded.categoryIds.groceries,
        },
      },
    });
    expect(row).toBeNull(); // engine removes zeroed allocations
    expect(result.readyToAssignCents).toBe(0);
  });
});

describe("copyPreviousMonthPlan — start from last month, then edit (D6)", () => {
  it("copies non-zero allocations into the current month", async () => {
    await seedPreviousMonth();

    const result = await copyPreviousMonthPlan(
      testDb,
      seeded.householdId,
      seeded.monthId,
    );

    const rows = await testDb.allocation.findMany({
      where: { monthId: seeded.monthId },
    });
    const byCategory = new Map(
      rows.map((r) => [r.categoryId, r.assignedCents]),
    );
    expect(byCategory.get(seeded.categoryIds.groceries)).toBe(25000);
    expect(byCategory.get(seeded.categoryIds.diningOut)).toBe(7500);

    expect(result.readyToAssignCents).toBe(-32500);
    expect(result.availability).toHaveLength(2);
  });

  it("surfaces PREVIOUS_MONTH_MISSING when no earlier month exists", async () => {
    await expect(
      copyPreviousMonthPlan(testDb, seeded.householdId, seeded.monthId),
    ).rejects.toMatchObject({
      name: "EngineError",
      code: "PREVIOUS_MONTH_MISSING",
    });
  });
});

describe("getPlannerSnapshot — the planner screen's engine view", () => {
  it("finds the seeded month and reports RTA, availability, and copy readiness", async () => {
    await seedPreviousMonth();
    await testDb.transaction.create({
      data: {
        accountId: seeded.accountIds.checking,
        kind: "INCOME",
        amountCents: 200000,
        date: new Date("2026-09-10T00:00:00.000Z"),
        payee: "Paycheck",
        reviewState: "CONFIRMED",
      },
    });

    const snapshot = await getPlannerSnapshot(
      testDb,
      seeded.householdId,
      "2026-09-15",
    );

    expect(snapshot.monthId).toBe(seeded.monthId);
    expect(snapshot.year).toBe(2026);
    expect(snapshot.month).toBe(9);
    expect(snapshot.incomeReceivedCents).toBe(200000);
    expect(snapshot.hasPreviousMonth).toBe(true);
    expect(snapshot.categories).toEqual([
      {
        id: seeded.categoryIds.groceries,
        name: "Groceries",
        group: "NEEDS",
      },
      {
        id: seeded.categoryIds.diningOut,
        name: "Dining Out",
        group: "WANTS",
      },
    ]);
    expect(snapshot.readyToAssignCents).toBe(200000);
  });

  it("scaffolds a missing month on demand and sees the prior month as copyable", async () => {
    // seedHousehold created September; snapshotting October scaffolds it and
    // correctly reports September as copyable.
    const snapshot = await getPlannerSnapshot(
      testDb,
      seeded.householdId,
      "2026-10-01",
    );

    expect(snapshot.year).toBe(2026);
    expect(snapshot.month).toBe(10);
    expect(snapshot.hasPreviousMonth).toBe(true);
    expect(snapshot.readyToAssignCents).toBe(0);
    expect(snapshot.availability).toHaveLength(2);
  });

  it("reports no previous month when the snapshot month is the earliest", async () => {
    const snapshot = await getPlannerSnapshot(
      testDb,
      seeded.householdId,
      "2026-09-15",
    );

    expect(snapshot.month).toBe(9);
    expect(snapshot.hasPreviousMonth).toBe(false);
  });
});
