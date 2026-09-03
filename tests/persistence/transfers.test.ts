import { beforeEach, describe, expect, it } from "vitest";

import { loadHouseholdEngineState } from "@/lib/repositories/engine-state";
import {
  recordHouseholdTransfer,
  withdrawToCashWallet,
} from "@/lib/repositories/transactions";
import { createBudgetEngine } from "@/src/engine";

import {
  resetDatabase,
  seedHousehold,
  testDb,
  type SeededHousehold,
} from "./test-db";

let seeded: SeededHousehold;

beforeEach(async () => {
  await resetDatabase();
  seeded = await seedHousehold(`transfer-${crypto.randomUUID()}`);
});

async function balancesOf(householdId: string): Promise<Map<string, number>> {
  const engine = createBudgetEngine(
    await loadHouseholdEngineState(testDb, householdId),
  );
  return new Map(
    engine
      .snapshot()
      .accounts.map((a) => [a.id, engine.accountBalanceCents(a.id)]),
  );
}

describe("transfer semantics end-to-end (D4)", () => {
  it("bank → cash withdrawal touches two accounts and zero categories", async () => {
    const result = await withdrawToCashWallet(testDb, seeded.householdId, {
      fromAccountId: seeded.accountIds.checking,
      amountCents: 4000,
      date: "2026-09-05",
    });

    // Exactly one Transfer row — not a transaction, not a category touch.
    const transfers = await testDb.transfer.findMany();
    expect(transfers).toHaveLength(1);
    expect(transfers[0].id).toBe(result.transferId);
    expect(transfers[0].fromAccountId).toBe(seeded.accountIds.checking);
    expect(transfers[0].toAccountId).toBe(seeded.accountIds.cash);
    expect(transfers[0].amountCents).toBe(4000);
    expect(transfers[0].payee).toBe("ATM withdrawal");

    expect(await testDb.transaction.count()).toBe(0);

    const balances = await balancesOf(seeded.householdId);
    expect(balances.get(seeded.accountIds.checking)).toBe(100000 - 4000);
    expect(balances.get(seeded.accountIds.cash)).toBe(5000 + 4000);
    expect(balances.get(seeded.accountIds.credit)).toBe(0);

    // The repository's returned view agrees with a fresh hydration.
    expect(
      result.accountBalances.find(
        (b) => b.accountId === seeded.accountIds.checking,
      ),
    ).toEqual({
      accountId: seeded.accountIds.checking,
      balanceCents: 96000,
    });
  });

  it("a general transfer (credit-card payment) moves both balances and no month cashflow", async () => {
    await recordHouseholdTransfer(testDb, seeded.householdId, {
      fromAccountId: seeded.accountIds.checking,
      toAccountId: seeded.accountIds.credit,
      amountCents: 15000,
      date: "2026-09-20",
      payee: "Card payment",
    });

    const transfers = await testDb.transfer.findMany();
    expect(transfers).toHaveLength(1);
    expect(transfers[0].payee).toBe("Card payment");

    // Card balance rises (debt shrinks), checking falls, zero transaction rows.
    const balances = await balancesOf(seeded.householdId);
    expect(balances.get(seeded.accountIds.credit)).toBe(15000);
    expect(balances.get(seeded.accountIds.checking)).toBe(85000);
    expect(await testDb.transaction.count()).toBe(0);

    // Availability is untouched: the payment isn't spending.
    const engine = createBudgetEngine(
      await loadHouseholdEngineState(testDb, seeded.householdId),
    );
    for (const available of engine.categoryAvailable(seeded.monthId)) {
      expect(available.availableCents).toBe(0);
    }
    expect(engine.monthCashflow(seeded.monthId).netCashflowCents).toBe(0);
  });

  it("rejects a self-transfer and persists nothing", async () => {
    await expect(
      recordHouseholdTransfer(testDb, seeded.householdId, {
        fromAccountId: seeded.accountIds.checking,
        toAccountId: seeded.accountIds.checking,
        amountCents: 1000,
        date: "2026-09-05",
        payee: "Loop",
      }),
    ).rejects.toMatchObject({ name: "EngineError", code: "SELF_TRANSFER" });

    expect(await testDb.transfer.count()).toBe(0);
  });

  it("keeps transfers household-scoped: a foreign account is unknown", async () => {
    const other = await seedHousehold(`other-${crypto.randomUUID()}`);

    await expect(
      recordHouseholdTransfer(testDb, other.householdId, {
        fromAccountId: seeded.accountIds.checking, // belongs to another household
        toAccountId: other.accountIds.cash,
        amountCents: 1000,
        date: "2026-09-05",
        payee: "Cross-household",
      }),
    ).rejects.toMatchObject({ name: "EngineError", code: "UNKNOWN_ACCOUNT" });

    expect(await testDb.transfer.count()).toBe(0);
  });
});
