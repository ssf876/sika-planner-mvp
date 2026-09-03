import { beforeEach, describe, expect, it } from "vitest";

import type { AccountFeed, FeedTransaction } from "@/src/feed/types";
import {
  confirmReviewedTransaction,
  getAutoAcceptSuggestions,
  loadReviewQueue,
  setAutoAcceptSuggestions,
} from "@/lib/repositories/categorizer";
import { importFromFeed } from "@/lib/repositories/csv-import";
import { RepositoryError } from "@/lib/repositories/errors";

import {
  resetDatabase,
  seedHousehold,
  testDb,
  type SeededHousehold,
} from "./test-db";

beforeEach(resetDatabase);

/** A feed stub for import tests — the importer only sees this contract. */
function feedOf(rows: Omit<FeedTransaction, "raw">[]): AccountFeed {
  return {
    kind: "csv",
    listNew: async () => rows.map((row) => ({ ...row, raw: {} })),
  };
}

async function stageNeedsReview(
  seed: SeededHousehold,
  payee: string,
  amountCents: number,
): Promise<string> {
  const row = await testDb.transaction.create({
    data: {
      accountId: seed.accountIds.checking,
      kind: amountCents > 0 ? "INCOME" : "EXPENSE",
      amountCents,
      date: new Date("2026-09-05"),
      payee,
      reviewState: "NEEDS_REVIEW",
    },
  });
  return row.id;
}

describe("review queue", () => {
  it("returns NEEDS_REVIEW rows oldest-first with fresh suggestions", async () => {
    const seed = await seedHousehold("queue");
    const first = await stageNeedsReview(seed, "Whole Foods Market", -5000);
    const second = await stageNeedsReview(seed, "Shell", -2000);

    const queue = await loadReviewQueue(testDb, seed.householdId);

    expect(queue.map((row) => row.id)).toEqual([first, second]);
    // Nothing confirmed yet — no history, no suggestions.
    expect(queue.map((row) => row.suggestion)).toEqual([null, null]);
  });

  it("suggests nothing for income rows", async () => {
    const seed = await seedHousehold("income queue");
    await stageNeedsReview(seed, "Paycheck", 100000);

    const queue = await loadReviewQueue(testDb, seed.householdId);
    expect(queue[0].suggestion).toBeNull();
  });
});

describe("confirmReviewedTransaction — the confirm-edit-learns loop", () => {
  it("a first confirm (an edit, no history) teaches the next suggestion", async () => {
    const seed = await seedHousehold("learn");
    const rowId = await stageNeedsReview(seed, "Whole Foods Market", -5000);

    const result = await confirmReviewedTransaction(testDb, seed.householdId, {
      transactionId: rowId,
      categoryId: seed.categoryIds.groceries,
    });

    // No history existed to suggest from, so this was an edit, not a match.
    expect(result.reviewState).toBe("EDITED");
    // Availability now reflects the spend through the engine.
    const groceries = result.categoryAvailability.find(
      (entry) => entry.categoryId === seed.categoryIds.groceries,
    );
    expect(groceries?.availableCents).toBe(-5000);

    // The next row with the same payee is pre-filled from what was learned.
    await stageNeedsReview(seed, "Whole Foods Market", -7500);
    const queue = await loadReviewQueue(testDb, seed.householdId);
    expect(queue[0].suggestion).toEqual({
      categoryId: seed.categoryIds.groceries,
      confidence: 1,
    });
  });

  it("accepting a suggestion confirms it; overriding it edits — both teach", async () => {
    const seed = await seedHousehold("match-vs-edit");
    const first = await stageNeedsReview(seed, "Whole Foods Market", -5000);
    await confirmReviewedTransaction(testDb, seed.householdId, {
      transactionId: first,
      categoryId: seed.categoryIds.groceries,
    });

    // Accepting the learned suggestion => CONFIRMED.
    const second = await stageNeedsReview(seed, "Whole Foods Market", -3000);
    const accepted = await confirmReviewedTransaction(
      testDb,
      seed.householdId,
      {
        transactionId: second,
        categoryId: seed.categoryIds.groceries,
      },
    );
    expect(accepted.reviewState).toBe("CONFIRMED");

    // Overriding the suggestion => EDITED, and the override becomes what's
    // learned for that payee.
    const third = await stageNeedsReview(seed, "Whole Foods Market", -1000);
    const overridden = await confirmReviewedTransaction(
      testDb,
      seed.householdId,
      {
        transactionId: third,
        categoryId: seed.categoryIds.diningOut,
      },
    );
    expect(overridden.reviewState).toBe("EDITED");

    await stageNeedsReview(seed, "Whole Foods Market", -100);
    const queue = await loadReviewQueue(testDb, seed.householdId);
    expect(queue[0].suggestion?.categoryId).toBe(seed.categoryIds.diningOut);
  });

  it("confirms income rows without a category", async () => {
    const seed = await seedHousehold("income confirm");
    const rowId = await stageNeedsReview(seed, "Paycheck", 100000);

    const result = await confirmReviewedTransaction(testDb, seed.householdId, {
      transactionId: rowId,
    });

    expect(result.reviewState).toBe("EDITED");
    const row = await testDb.transaction.findUnique({
      where: { id: rowId },
      select: { categoryId: true, reviewState: true },
    });
    expect(row).toMatchObject({ categoryId: null, reviewState: "EDITED" });
  });

  it("rejects foreign rows, double confirms, and category-less expenses", async () => {
    const seed = await seedHousehold("guards");
    const other = await seedHousehold("other household");
    const rowId = await stageNeedsReview(seed, "Whole Foods Market", -5000);

    await expect(
      confirmReviewedTransaction(testDb, other.householdId, {
        transactionId: rowId,
        categoryId: seed.categoryIds.groceries,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    } satisfies Partial<RepositoryError>);

    await expect(
      confirmReviewedTransaction(testDb, seed.householdId, {
        transactionId: rowId,
      }),
    ).rejects.toMatchObject({
      code: "CATEGORY_REQUIRED",
    } satisfies Partial<RepositoryError>);

    await confirmReviewedTransaction(testDb, seed.householdId, {
      transactionId: rowId,
      categoryId: seed.categoryIds.groceries,
    });
    await expect(
      confirmReviewedTransaction(testDb, seed.householdId, {
        transactionId: rowId,
        categoryId: seed.categoryIds.groceries,
      }),
    ).rejects.toMatchObject({
      code: "ALREADY_REVIEWED",
    } satisfies Partial<RepositoryError>);
  });
});

describe("auto-accept at import (per household setting)", () => {
  it("defaults to off — rows land NEEDS_REVIEW even with confident history", async () => {
    const seed = await seedHousehold("auto-off");
    expect(await getAutoAcceptSuggestions(testDb, seed.householdId)).toBe(
      false,
    );

    const rowId = await stageNeedsReview(seed, "Whole Foods Market", -5000);
    await confirmReviewedTransaction(testDb, seed.householdId, {
      transactionId: rowId,
      categoryId: seed.categoryIds.groceries,
    });

    const summary = await importFromFeed(
      testDb,
      seed.householdId,
      seed.accountIds.checking,
      feedOf([
        {
          externalId: "wf-2",
          date: "2026-09-06",
          payee: "Whole Foods Market",
          amountCents: -2500,
          pending: false,
        },
      ]),
    );
    expect(summary.autoAccepted).toBe(0);
    const row = await testDb.transaction.findUnique({
      where: {
        accountId_externalId: {
          accountId: seed.accountIds.checking,
          externalId: "wf-2",
        },
      },
      select: { reviewState: true, categoryId: true },
    });
    expect(row).toMatchObject({
      reviewState: "NEEDS_REVIEW",
      categoryId: null,
    });
  });

  it("when on, exact-match expenses land AUTO_ACCEPTED with their category", async () => {
    const seed = await seedHousehold("auto-on");
    const rowId = await stageNeedsReview(seed, "Whole Foods Market", -5000);
    await confirmReviewedTransaction(testDb, seed.householdId, {
      transactionId: rowId,
      categoryId: seed.categoryIds.groceries,
    });
    await setAutoAcceptSuggestions(testDb, seed.householdId, true);

    const summary = await importFromFeed(
      testDb,
      seed.householdId,
      seed.accountIds.checking,
      feedOf([
        {
          externalId: "wf-2",
          date: "2026-09-06",
          payee: "Whole Foods Market",
          amountCents: -2500,
          pending: false,
        },
        {
          externalId: "pay-1",
          date: "2026-09-06",
          payee: "Employer",
          amountCents: 300000,
          pending: false,
        },
      ]),
    );

    // Only the confident expense is auto-accepted; income never is.
    expect(summary.autoAccepted).toBe(1);
    const rows = await testDb.transaction.findMany({
      where: {
        accountId: seed.accountIds.checking,
        reviewState: "AUTO_ACCEPTED",
      },
      select: { payee: true, categoryId: true },
    });
    expect(rows).toEqual([
      { payee: "Whole Foods Market", categoryId: seed.categoryIds.groceries },
    ]);
  });

  it("never auto-accepts below the confidence line, even when the setting is on", async () => {
    const seed = await seedHousehold("auto-threshold");
    const rowId = await stageNeedsReview(seed, "Shell", -4000);
    await confirmReviewedTransaction(testDb, seed.householdId, {
      transactionId: rowId,
      categoryId: seed.categoryIds.groceries,
    });
    await setAutoAcceptSuggestions(testDb, seed.householdId, true);

    // A keyword-level match (not exact) stays below the >0.9 line.
    const summary = await importFromFeed(
      testDb,
      seed.householdId,
      seed.accountIds.checking,
      feedOf([
        {
          externalId: "shell-2",
          date: "2026-09-06",
          payee: "Shell Gas Station",
          amountCents: -3500,
          pending: false,
        },
      ]),
    );

    expect(summary.autoAccepted).toBe(0);
    const row = await testDb.transaction.findUnique({
      where: {
        accountId_externalId: {
          accountId: seed.accountIds.checking,
          externalId: "shell-2",
        },
      },
      select: { reviewState: true },
    });
    expect(row?.reviewState).toBe("NEEDS_REVIEW");
  });
});
