import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { CsvFeed } from "@/src/feed/csv-feed";
import { applyCsvMapping } from "@/src/feed/mapping";
import type { CsvColumnMapping } from "@/src/feed/types";
import { createBudgetEngine } from "@/src/engine";
import { importFromFeed } from "@/lib/repositories/csv-import";
import { loadHouseholdEngineState } from "@/lib/repositories/engine-state";

import {
  resetDatabase,
  seedHousehold,
  testDb,
  type SeededHousehold,
} from "./test-db";

const fixturePath = path.join(
  import.meta.dirname,
  "../feed/fixtures/generic-bank-export.csv",
);
const fixtureCsv = readFileSync(fixturePath, "utf8");

// The fixture is a generic export (open question Q2): id, date, payee,
// amount, memo, and a settlement status column.
const mapping: CsvColumnMapping = {
  date: "Date",
  payee: "Description",
  amount: "Amount",
  memo: "Memo",
  externalId: "Transaction ID",
  pending: "Status",
};

function mappedFixture() {
  return applyCsvMapping(fixtureCsv, mapping);
}

function importFixture(
  seed: SeededHousehold,
  accountId: string,
  options?: { since?: Date },
) {
  return importFromFeed(
    testDb,
    seed.householdId,
    accountId,
    new CsvFeed(fixtureCsv, mapping),
    options,
  );
}

beforeEach(resetDatabase);

describe("importFromFeed (generic-format fixture)", () => {
  it("maps then stages valid rows, reporting duplicates and malformed rows", async () => {
    const seed = await seedHousehold("csv import");
    const mapped = mappedFixture();

    // 5 valid rows; row 5 repeats TXN-9002; rows 8-10 are malformed.
    expect(mapped.transactions).toHaveLength(5);
    expect(mapped.duplicates).toHaveLength(1);
    expect(mapped.malformed.map((row) => row.row)).toEqual([8, 9, 10]);

    const summary = await importFixture(seed, seed.accountIds.checking);
    expect(summary.imported).toBe(5);
    // skippedDuplicates counts only database duplicates rejected here; the
    // in-file repeat is reported at the mapping stage (mapped.duplicates)
    // and composed into the user-facing summary by the import action.
    expect(summary.skippedDuplicates).toBe(0);
    expect(summary.duplicateExternalIds).toEqual([]);

    const rows = await testDb.transaction.findMany({
      where: { accountId: seed.accountIds.checking },
    });
    expect(rows).toHaveLength(5);

    const payroll = rows.find((row) => row.externalId === "TXN-9002")!;
    expect(payroll).toMatchObject({
      kind: "INCOME",
      amountCents: 250000,
      pending: false,
      reviewState: "NEEDS_REVIEW",
      categoryId: null,
    });

    // Pending-transaction handling: the settlement column drives `pending`.
    const metro = rows.find((row) => row.externalId === "TXN-9003")!;
    expect(metro).toMatchObject({
      kind: "EXPENSE",
      amountCents: -4275,
      pending: true,
      note: "Monthly transit pass",
      reviewState: "NEEDS_REVIEW",
    });

    // US-style dates normalize to household-local ISO.
    const coffee = rows.find((row) => row.externalId === "TXN-9005")!;
    expect(coffee.payee).toBe("Uptown Coffee");
    expect(coffee.date.toISOString().slice(0, 10)).toBe("2026-09-04");

    // Imported rows are engine-visible: the checking balance moved by the
    // staged rows (income + expenses, pending included).
    const state = await loadHouseholdEngineState(testDb, seed.householdId);
    const engine = createBudgetEngine(state);
    expect(engine.accountBalanceCents(seed.accountIds.checking)).toBe(
      100000 - 8640 + 250000 - 4275 + 1850 - 495,
    );
  });

  it("scaffolds months for imported dates the household hasn't planned", async () => {
    const seed = await seedHousehold("csv import");
    const octoberCsv =
      "Transaction ID,Date,Description,Amount,Status\n" +
      "TXN-9101,2026-10-02,Rent,-1800.00,POSTED";

    const summary = await importFromFeed(
      testDb,
      seed.householdId,
      seed.accountIds.checking,
      new CsvFeed(octoberCsv, {
        date: "Date",
        payee: "Description",
        amount: "Amount",
        externalId: "Transaction ID",
        pending: "Status",
      }),
    );
    expect(summary.imported).toBe(1);

    const october = await testDb.month.findUnique({
      where: {
        householdId_year_month: {
          householdId: seed.householdId,
          year: 2026,
          month: 10,
        },
      },
    });
    expect(october).not.toBeNull();
  });

  it("re-imports the same fixture as a no-op", async () => {
    const seed = await seedHousehold("csv import");
    await importFixture(seed, seed.accountIds.checking);

    const again = await importFixture(seed, seed.accountIds.checking);
    expect(again.imported).toBe(0);
    // All 5 staged rows now hit the per-account dedupe key.
    expect(again.skippedDuplicates).toBe(5);
    expect(again.duplicateExternalIds).toEqual([
      "TXN-9001",
      "TXN-9002",
      "TXN-9003",
      "TXN-9004",
      "TXN-9005",
    ]);

    const count = await testDb.transaction.count({
      where: { accountId: seed.accountIds.checking },
    });
    expect(count).toBe(5);
  });

  it("imports the same export into a different account independently", async () => {
    const seed = await seedHousehold("csv import");
    await importFixture(seed, seed.accountIds.checking);

    // Dedupe keys are per-account: the same bank rows on another account
    // (e.g. the same payroll seen in checking and savings) still import.
    const other = await importFixture(seed, seed.accountIds.credit);
    expect(other.imported).toBe(5);
  });

  it("rejects imports into another household's account", async () => {
    const owner = await seedHousehold("owner");
    await seedHousehold("intruder");

    await expect(
      importFixture(
        { ...owner, householdId: "not-a-real-household" },
        owner.accountIds.checking,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps imports atomic when the feed fails mid-flight", async () => {
    const seed = await seedHousehold("csv import");
    const before = await testDb.transaction.count({
      where: { accountId: seed.accountIds.checking },
    });

    const explodingFeed = {
      kind: "csv",
      listNew: async () => {
        throw new Error("feed blew up");
      },
    };
    await expect(
      importFromFeed(
        testDb,
        seed.householdId,
        seed.accountIds.checking,
        explodingFeed,
      ),
    ).rejects.toThrow("feed blew up");

    expect(
      await testDb.transaction.count({
        where: { accountId: seed.accountIds.checking },
      }),
    ).toBe(before);
  });
});
