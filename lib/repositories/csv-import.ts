/**
 * Feed import repository (D4) — stages AccountFeed rows into an account's
 * ledger, keyed for idempotency by (accountId, externalId).
 *
 * Imported rows land NEEDS_REVIEW with no category yet (the spec's review
 * queue is D5): they move account balances immediately but deplete a category
 * only once confirmed with one, so an uncategorized outflow can never imply a
 * category the user never picked.
 */

import type { PrismaClient } from "@prisma/client";

import { loadAutoAcceptGate } from "./categorizer";
import { requireOwnedAccount } from "./accounts";
import { calendarDateToDate } from "./engine-state";
import { ensureMonthCovers } from "./transactions";
import type { AccountFeed } from "@/src/feed/types";

export interface ImportSummary {
  /** Rows staged into the ledger. */
  imported: number;
  /** Rows already imported under the same dedupe key. In-file repeats are
   * reported by the mapping stage and composed by the import action. */
  skippedDuplicates: number;
  /** externalIds of rejected duplicates, capped for display. */
  duplicateExternalIds: string[];
  /** Rows the categorizer auto-accepted (D5, per household setting). */
  autoAccepted: number;
}

const DUPLICATE_ID_REPORT_LIMIT = 10;

/**
 * Import a feed into an owned account. Re-uploading the same export is a
 * no-op: every row collides on (accountId, externalId) and is skipped.
 * Runs inside one transaction — a failed import writes nothing.
 */
export async function importFromFeed(
  db: PrismaClient,
  householdId: string,
  accountId: string,
  feed: AccountFeed,
  options?: { since?: Date },
): Promise<ImportSummary> {
  await requireOwnedAccount(db, householdId, accountId);
  const feedRows = await feed.listNew({ accountId }, options?.since);

  // Reject in-file duplicates: first occurrence wins.
  const seen = new Set<string>();
  const batch = [];
  const duplicateExternalIds = [];
  for (const tx of feedRows) {
    if (seen.has(tx.externalId)) {
      duplicateExternalIds.push(tx.externalId);
      continue;
    }
    seen.add(tx.externalId);
    batch.push(tx);
  }

  // Reject rows an earlier import already staged under the same key.
  const existing = await db.transaction.findMany({
    where: { accountId, externalId: { in: [...seen] } },
    select: { externalId: true },
  });
  const alreadyImported = new Set(existing.map((row) => row.externalId));
  const fresh = batch.filter((tx) => {
    if (alreadyImported.has(tx.externalId)) {
      duplicateExternalIds.push(tx.externalId);
      return false;
    }
    return true;
  });

  // The auto-accept gate reads the household setting + confirmed history
  // once for the whole batch; null when the setting is off (the default).
  const autoAccept = await loadAutoAcceptGate(db, householdId);
  let autoAccepted = 0;

  if (fresh.length > 0) {
    await db.$transaction(async (tx) => {
      // Scaffold every month the import touches, so the planner and the
      // review queue have months to work in even for unplanned dates.
      const months = new Set(fresh.map((row) => row.date.slice(0, 7)));
      for (const yearMonth of months) {
        await ensureMonthCovers(tx, householdId, `${yearMonth}-01`);
      }

      await tx.transaction.createMany({
        data: fresh.map((row) => {
          const kind =
            row.amountCents > 0 ? ("INCOME" as const) : ("EXPENSE" as const);
          // High-confidence suggestion + setting on: the row lands
          // AUTO_ACCEPTED with its category (and depletes it), never
          // silently — the summary reports the count.
          const suggestion = autoAccept?.(row.payee, kind) ?? null;
          if (suggestion) autoAccepted += 1;
          return {
            accountId,
            kind,
            amountCents: row.amountCents,
            date: calendarDateToDate(row.date),
            payee: row.payee,
            note: row.memo ?? null,
            externalId: row.externalId,
            pending: row.pending,
            categoryId: suggestion?.categoryId,
            reviewState: suggestion
              ? ("AUTO_ACCEPTED" as const)
              : ("NEEDS_REVIEW" as const),
          };
        }),
      });
    });
  }

  return {
    imported: fresh.length,
    skippedDuplicates: duplicateExternalIds.length,
    duplicateExternalIds: duplicateExternalIds.slice(
      0,
      DUPLICATE_ID_REPORT_LIMIT,
    ),
    autoAccepted,
  };
}
