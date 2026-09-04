import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardSnapshot } from "@/lib/repositories/dashboard";

import { recordManualTransaction } from "@/lib/repositories/transactions";

import {
  resetDatabase,
  seedHousehold,
  testDb,
  type SeededHousehold,
} from "../persistence/test-db";

let seeded: SeededHousehold;

beforeEach(async () => {
  await resetDatabase();
  seeded = await seedHousehold(`dashboard-snapshot-${crypto.randomUUID()}`);
});

/**
 * The v1.1 recent-activity extension (tier 4): a read-only glimpse of the
 * newest transactions on the dashboard snapshot — newest-first, capped at
 * five, with the names the UI renders resolved server-side. Everything else
 * in the snapshot must behave exactly as before.
 */
describe("getDashboardSnapshot — recentTransactions extension", () => {
  async function createTransaction(overrides: {
    accountId: string;
    categoryId?: string | null;
    amountCents: number;
    date: string;
    payee: string;
    kind?: "INCOME" | "EXPENSE";
  }) {
    return testDb.transaction.create({
      data: {
        accountId: overrides.accountId,
        categoryId: overrides.categoryId ?? null,
        kind: overrides.kind ?? "EXPENSE",
        amountCents: overrides.amountCents,
        date: new Date(`${overrides.date}T00:00:00.000Z`),
        payee: overrides.payee,
        reviewState: "CONFIRMED",
      },
    });
  }

  it("returns the newest transactions first with resolved names, capped at five", async () => {
    // Six transactions across six days — one more than the cap.
    for (let day = 1; day <= 6; day += 1) {
      await createTransaction({
        accountId: seeded.accountIds.checking,
        categoryId: seeded.categoryIds.groceries,
        amountCents: -(1000 + day),
        date: `2026-09-${String(day).padStart(2, "0")}`,
        payee: `Payee day ${day}`,
      });
    }

    const snapshot = await getDashboardSnapshot(
      testDb,
      seeded.householdId,
      "2026-09-07",
    );

    expect(snapshot.recentTransactions).toHaveLength(5);
    // Newest first: days 6, 5, 4, 3, 2 — day 1 fell off the glimpse.
    expect(snapshot.recentTransactions.map((row) => row.payee)).toEqual([
      "Payee day 6",
      "Payee day 5",
      "Payee day 4",
      "Payee day 3",
      "Payee day 2",
    ]);

    const newest = snapshot.recentTransactions[0];
    expect(newest).toMatchObject({
      payee: "Payee day 6",
      amountCents: -1006,
      kind: "EXPENSE",
      category: "Groceries",
      account: "Everyday",
      date: "2026-09-06",
      dateLabel: "Sep 6",
    });
  });

  it("renders income with its signed amount and skips the absent category", async () => {
    await createTransaction({
      accountId: seeded.accountIds.checking,
      categoryId: seeded.categoryIds.groceries,
      amountCents: -2500,
      date: "2026-09-01",
      payee: "Corner Grocer",
    });
    await createTransaction({
      accountId: seeded.accountIds.checking,
      amountCents: 500000,
      date: "2026-09-02",
      payee: "Acme Payroll",
      kind: "INCOME",
    });

    const snapshot = await getDashboardSnapshot(
      testDb,
      seeded.householdId,
      "2026-09-03",
    );

    expect(snapshot.recentTransactions).toHaveLength(2);
    const [payroll, grocer] = snapshot.recentTransactions;
    expect(payroll).toMatchObject({
      payee: "Acme Payroll",
      amountCents: 500000,
      kind: "INCOME",
      category: null,
      dateLabel: "Sep 2",
    });
    expect(grocer).toMatchObject({
      payee: "Corner Grocer",
      amountCents: -2500,
      category: "Groceries",
      dateLabel: "Sep 1",
    });
  });

  it("never leaks another household's transactions", async () => {
    const other = await seedHousehold(`other-${crypto.randomUUID()}`);
    await createTransaction({
      accountId: seeded.accountIds.checking,
      amountCents: -1500,
      date: "2026-09-01",
      payee: "Mine",
    });
    await createTransaction({
      accountId: other.accountIds.checking,
      amountCents: -9900,
      date: "2026-09-02",
      payee: "Theirs",
    });

    const snapshot = await getDashboardSnapshot(
      testDb,
      seeded.householdId,
      "2026-09-03",
    );

    expect(snapshot.recentTransactions.map((row) => row.payee)).toEqual([
      "Mine",
    ]);
  });

  it("leaves every pre-existing snapshot field working as before", async () => {
    const income = await recordManualTransaction(testDb, seeded.householdId, {
      accountId: seeded.accountIds.checking,
      kind: "INCOME",
      amountCents: 400000,
      date: "2026-09-01",
      payee: "Employer",
    });
    const expense = await recordManualTransaction(testDb, seeded.householdId, {
      accountId: seeded.accountIds.checking,
      kind: "EXPENSE",
      amountCents: -2500,
      date: "2026-09-02",
      payee: "Corner Grocer",
      categoryId: seeded.categoryIds.groceries,
    });

    const snapshot = await getDashboardSnapshot(
      testDb,
      seeded.householdId,
      "2026-09-03",
    );

    // The extension added a field; it changed nothing else.
    expect(snapshot.monthLabel).toBe("September 2026");
    expect(snapshot.hasTransactions).toBe(true);
    // Ready to Assign agrees with the repository's own last computation —
    // and recording the expense didn't move it (zero-based: spending from a
    // planned category depletes its availability, not Ready to Assign).
    expect(snapshot.readyToAssignCents).toBe(expense.readyToAssignCents);
    expect(expense.readyToAssignCents).toBe(income.readyToAssignCents);
    expect(snapshot.budget).toEqual({
      spentCents: 2500,
      assignedCents: 0,
    });
    expect(snapshot.sections).toHaveLength(5);
    // $25 spent against a category with $0 assigned is an overspend, so the
    // engine's verdict is overspent — the extension did not touch danger.
    expect(snapshot.danger.overall).toBe("overspent");
    expect(snapshot.recentTransactions).toHaveLength(2);
  });
});
