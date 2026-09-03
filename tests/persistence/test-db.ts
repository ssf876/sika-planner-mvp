/**
 * Throwaway SQLite database for persistence tests.
 *
 * Each test process gets its own database file; the committed migrations are
 * applied with `prisma migrate deploy` exactly like CI does. IMPORTANT: import
 * this module BEFORE anything that imports `@/lib/db` — the Prisma client
 * resolves DATABASE_URL when it is constructed, so the helper must set the
 * env var first.
 */

import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

function applyMigrations(databaseUrl: string): void {
  const prismaBin = path.join(process.cwd(), "node_modules", ".bin", "prisma");
  execSync(`${prismaBin} migrate deploy`, {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}

const testDir = mkdtempSync(path.join(tmpdir(), "sika-persistence-"));
const databaseUrl = `file:${path.join(testDir, "test.db")}`;
applyMigrations(databaseUrl);

process.env.DATABASE_URL = databaseUrl;

/** Client bound to the throwaway database (never @/lib/db's singleton). */
export const testDb = new PrismaClient();

/**
 * Wipe every row (FK-safe order), so each test in a file starts from an empty
 * database even though the file shares one throwaway DB.
 */
export async function resetDatabase(): Promise<void> {
  await testDb.fundDraw.deleteMany();
  await testDb.transaction.deleteMany();
  await testDb.transfer.deleteMany();
  await testDb.allocation.deleteMany();
  await testDb.month.deleteMany();
  await testDb.category.deleteMany();
  await testDb.fund.deleteMany();
  await testDb.account.deleteMany();
  await testDb.household.deleteMany();
}

export interface SeededHousehold {
  householdId: string;
  categoryIds: { groceries: string; diningOut: string };
  accountIds: { checking: string; cash: string; credit: string };
  /** September 2026 — the month every fixture entry is dated in. */
  monthId: string;
}

const SEED_MONTH = { year: 2026, month: 9 };

/**
 * Seed the minimum the engine hydrates: household, two categories, one month
 * with $0 allocations, and three accounts (checking 1000.00, cash 50.00,
 * credit 0.00).
 */
export async function seedHousehold(label: string): Promise<SeededHousehold> {
  const household = await testDb.household.create({
    data: { name: label, monthlyIncomeCents: 400000 },
  });

  const groceries = await testDb.category.create({
    data: { householdId: household.id, group: "NEEDS", name: "Groceries" },
  });
  const diningOut = await testDb.category.create({
    data: { householdId: household.id, group: "WANTS", name: "Dining Out" },
  });

  const month = await testDb.month.create({
    data: {
      householdId: household.id,
      ...SEED_MONTH,
      expectedIncomeCents: 400000,
    },
  });
  await testDb.allocation.createMany({
    data: [groceries, diningOut].map((category) => ({
      monthId: month.id,
      categoryId: category.id,
      assignedCents: 0,
    })),
  });

  const checking = await testDb.account.create({
    data: {
      householdId: household.id,
      kind: "CHECKING",
      name: "Everyday",
      startingCents: 100000,
    },
  });
  const cash = await testDb.account.create({
    data: {
      householdId: household.id,
      kind: "CASH",
      name: "Wallet",
      startingCents: 5000,
    },
  });
  const credit = await testDb.account.create({
    data: {
      householdId: household.id,
      kind: "CREDIT",
      name: "Card",
      startingCents: 0,
    },
  });

  return {
    householdId: household.id,
    categoryIds: { groceries: groceries.id, diningOut: diningOut.id },
    accountIds: { checking: checking.id, cash: cash.id, credit: credit.id },
    monthId: month.id,
  };
}
