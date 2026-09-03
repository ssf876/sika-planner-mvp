/**
 * Categorizer persistence (D5) — wires the pure learner in src/categorizer
 * to the household's confirmed stream and the review queue.
 *
 * Learning is never a separate store: a confirm/edit writes the transaction
 * row as CONFIRMED/EDITED, and that row IS the learned evidence the next
 * suggestion reads. Auto-accept runs at import time — the only moment a row
 * can land pre-categorized — and only ever fires above the spec's >0.9
 * confidence line, which in v1 means exact payee matches.
 */

import type { PrismaClient, TxKind } from "@prisma/client";

import {
  AUTO_ACCEPT_CONFIDENCE,
  createCategorizer,
  type CategorizerSuggestion,
  type ConfirmedCategorization,
} from "@/src/categorizer";
import { createBudgetEngine } from "@/src/engine";

import { RepositoryError } from "./errors";
import { loadHouseholdEngineState, type Db } from "./engine-state";
import { ensureMonthCovers } from "./transactions";

/** Review-state values that represent a human categorization decision. */
const LEARNED_REVIEW_STATES = ["CONFIRMED", "EDITED"] as const;

/**
 * The confirmed history the categorizer learns from: expense rows the user
 * actually categorized. AUTO_ACCEPTED rows are excluded on purpose — letting
 * the learner read its own suggestions would let one wrong guess reinforce
 * itself. Reversal (measured accuracy below what the queue tolerates) can
 * revisit this.
 */
export async function loadConfirmedHistory(
  db: Db,
  householdId: string,
): Promise<ConfirmedCategorization[]> {
  const rows = await db.transaction.findMany({
    where: {
      account: { householdId },
      kind: "EXPENSE",
      categoryId: { not: null },
      reviewState: { in: [...LEARNED_REVIEW_STATES] },
    },
    select: { payee: true, categoryId: true, date: true },
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });
  return rows.map((row) => ({
    payee: row.payee,
    categoryId: row.categoryId ?? "",
    date: calendarDate(row.date),
  }));
}

function calendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** One row waiting in the review queue, with the learner's pre-fill. */
export interface ReviewQueueRow {
  id: string;
  accountName: string;
  kind: TxKind;
  /** Signed; positive = money in. */
  amountCents: number;
  /** Household-local ISO date ("YYYY-MM-DD"). */
  date: string;
  payee: string;
  pending: boolean;
  note: string | null;
  /** Pre-filled suggestion, or null when history offers nothing. */
  suggestion: CategorizerSuggestion | null;
}

/**
 * The household's NEEDS_REVIEW rows, oldest first, each with a fresh
 * suggestion computed from the current confirmed history — so the queue
 * improves every time the user confirms or edits a row.
 */
export async function loadReviewQueue(
  db: Db,
  householdId: string,
): Promise<ReviewQueueRow[]> {
  const [rows, history] = await Promise.all([
    db.transaction.findMany({
      where: { account: { householdId }, reviewState: "NEEDS_REVIEW" },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: {
        id: true,
        kind: true,
        amountCents: true,
        date: true,
        payee: true,
        pending: true,
        note: true,
        account: { select: { name: true } },
      },
    }),
    loadConfirmedHistory(db, householdId),
  ]);
  const categorizer = createCategorizer(history);
  return rows.map((row) => ({
    id: row.id,
    accountName: row.account.name,
    kind: row.kind,
    amountCents: row.amountCents,
    date: calendarDate(row.date),
    payee: row.payee,
    pending: row.pending,
    note: row.note,
    // Only spending has a category to suggest — income lands in Ready to Assign.
    suggestion:
      row.kind === "EXPENSE"
        ? categorizer.suggest({ payee: row.payee })
        : null,
  }));
}

/**
 * The auto-accept gate for an import batch: loads the household setting, the
 * confirmed history, and the live category ids once, then answers per row.
 * Returns null (never auto-accept) when the setting is off — the honest
 * default. Only expenses with a suggestion above the spec's >0.9 confidence
 * line (exact matches in v1) clear the gate.
 */
export async function loadAutoAcceptGate(
  db: Db,
  householdId: string,
): Promise<((payee: string, kind: TxKind) => CategorizerSuggestion | null) | null> {
  const household = await db.household.findUnique({
    where: { id: householdId },
    select: { autoAcceptSuggestions: true },
  });
  if (!household?.autoAcceptSuggestions) return null;

  const [history, categoryIds] = await Promise.all([
    loadConfirmedHistory(db, householdId),
    db.category.findMany({
      where: { householdId },
      select: { id: true },
    }),
  ]);
  const liveCategoryIds = new Set(categoryIds.map((c) => c.id));
  const categorizer = createCategorizer(history);

  return (payee: string, kind: TxKind): CategorizerSuggestion | null => {
    if (kind !== "EXPENSE") return null;
    const suggestion = categorizer.suggest({ payee });
    if (!suggestion || suggestion.confidence <= AUTO_ACCEPT_CONFIDENCE) {
      return null;
    }
    // A suggestion can outlive its category (deleted since it was
    // confirmed); refuse to attach it rather than FK-fail the import.
    return liveCategoryIds.has(suggestion.categoryId) ? suggestion : null;
  };
}

export interface ConfirmReviewedInput {
  transactionId: string;
  /** Required for EXPENSE — confirming an outflow picks what it depleted. */
  categoryId?: string;
}

export interface ConfirmReviewedResult {
  transactionId: string;
  /** CONFIRMED when the row matched its suggestion, EDITED when overridden. */
  reviewState: "CONFIRMED" | "EDITED";
  monthId: string;
  /** Availability for every category in the affected month, after confirm. */
  categoryAvailability: {
    categoryId: string;
    availableCents: number;
  }[];
}

/**
 * One-click confirm (or edit-then-confirm) of a review-queue row: attaches
 * the chosen category, records the human decision in the review state, and
 * recomputes the month's category availability through the engine. The
 * updated row joins the confirmed stream, so the next suggestion learns.
 */
export async function confirmReviewedTransaction(
  db: PrismaClient,
  householdId: string,
  input: ConfirmReviewedInput,
): Promise<ConfirmReviewedResult> {
  return db.$transaction(async (tx) => {
    const row = await tx.transaction.findUnique({
      where: { id: input.transactionId },
      select: {
        accountId: true,
        kind: true,
        date: true,
        payee: true,
        reviewState: true,
      },
    });
    // Tenancy first: a foreign or missing id is the same "not here" answer.
    const accountHousehold = row
      ? await accountHouseholdId(tx, row.accountId)
      : null;
    if (!row || accountHousehold !== householdId) {
      throw new RepositoryError(
        "NOT_FOUND",
        "That transaction isn't in your household's ledger.",
      );
    }
    if (row.reviewState !== "NEEDS_REVIEW") {
      throw new RepositoryError(
        "ALREADY_REVIEWED",
        "That row was already reviewed.",
      );
    }

    let categoryId: string | null = null;
    if (row.kind === "EXPENSE") {
      if (!input.categoryId) {
        throw new RepositoryError(
          "CATEGORY_REQUIRED",
          "Pick a category — confirming an expense decides what it depleted.",
        );
      }
      const category = await tx.category.findFirst({
        where: { id: input.categoryId, householdId },
        select: { id: true },
      });
      if (!category) {
        throw new RepositoryError(
          "NOT_FOUND",
          "That category doesn't exist for your household.",
        );
      }
      categoryId = category.id;
    }

    // The review state records what the human decided: accepting the
    // suggestion confirms it; overriding it marks the row edited. Both teach.
    const history = await loadConfirmedHistory(tx, householdId);
    const suggestion = createCategorizer(history).suggest({
      payee: row.payee,
    });
    const reviewState: "CONFIRMED" | "EDITED" =
      row.kind === "EXPENSE" && suggestion?.categoryId === categoryId
        ? "CONFIRMED"
        : "EDITED";

    const { id: transactionId } = await tx.transaction.update({
      where: { id: input.transactionId },
      data: { categoryId, reviewState },
      select: { id: true },
    });

    const monthId = await ensureMonthCovers(tx, householdId, row.date);
    // Hydrate after the update: the engine state now carries the chosen
    // category, so its availability math stays the single source of truth.
    const state = await loadHouseholdEngineState(tx, householdId);
    const categoryAvailability = createBudgetEngine(state).categoryAvailable(
      monthId,
    );

    return { transactionId, reviewState, monthId, categoryAvailability };
  });
}

async function accountHouseholdId(
  db: Db,
  accountId: string,
): Promise<string | null> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { householdId: true },
  });
  return account?.householdId ?? null;
}

/** Read the household's auto-accept setting (per-household, default off). */
export async function getAutoAcceptSuggestions(
  db: Db,
  householdId: string,
): Promise<boolean> {
  const household = await db.household.findUnique({
    where: { id: householdId },
    select: { autoAcceptSuggestions: true },
  });
  return household?.autoAcceptSuggestions ?? false;
}

/** Toggle the household's high-confidence auto-accept setting. */
export async function setAutoAcceptSuggestions(
  db: PrismaClient,
  householdId: string,
  enabled: boolean,
): Promise<void> {
  await db.household.update({
    where: { id: householdId },
    data: { autoAcceptSuggestions: enabled },
  });
}
