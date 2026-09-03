/**
 * Transactions + transfers repository (D4 part 1) — manual entry with review
 * states and the transfer semantics, wired end-to-end through the engine:
 *
 *   hydrate household state → run engine op → diff snapshot → persist rows
 *
 * All of it runs inside one Prisma transaction, so a rejected op leaves no
 * partial rows behind.
 */

import type { ReviewState } from "@prisma/client";

import {
  calendarMonth,
  createBudgetEngine,
  type CategoryAvailable,
  type Transaction,
} from "@/src/engine";

import {
  diffEngineStates,
  loadHouseholdEngineState,
  persistEngineDelta,
  type Db,
  type TransactionalDb,
} from "./engine-state";

/** Manual and feed entries share the engine's input shape, minus TRANSFER (a
 * transfer is a two-account move through recordTransfer, never a transaction). */
export type ManualTxKind = Extract<Transaction["kind"], "INCOME" | "EXPENSE">;

export interface ManualTransactionInput {
  accountId: string;
  kind: ManualTxKind;
  /** Signed; positive = money in, negative = money out. */
  amountCents: number;
  date: string | Date;
  payee: string;
  /** Required for EXPENSE — any outflow depletes its category immediately. */
  categoryId?: string;
  note?: string;
  externalId?: string;
  pending?: boolean;
  /** Defaults to CONFIRMED: the user chose the category as they typed. */
  reviewState?: ReviewState;
}

export interface RecordedTransaction {
  transaction: Transaction;
  monthId: string;
  /** Availability for every category in the affected month, after the entry. */
  categoryAvailability: CategoryAvailable[];
  readyToAssignCents: number;
}

/**
 * Find or scaffold the month covering `date`, so entries dated in months the
 * household hasn't planned yet still land. A scaffolded month carries the
 * household's expected income and $0 allocations for every category — the
 * same shape onboarding seeds.
 */
export async function ensureMonthCovers(
  db: Db,
  householdId: string,
  date: string | Date,
): Promise<string> {
  const { year, month } = calendarMonth(date);
  const existing = await db.month.findUnique({
    where: { householdId_year_month: { householdId, year, month } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const household = await db.household.findUniqueOrThrow({
    where: { id: householdId },
    select: { monthlyIncomeCents: true },
  });
  const created = await db.month.create({
    data: {
      householdId,
      year,
      month,
      expectedIncomeCents: household.monthlyIncomeCents ?? 0,
    },
    select: { id: true },
  });
  const categories = await db.category.findMany({
    where: { householdId },
    select: { id: true },
  });
  await db.allocation.createMany({
    data: categories.map((category) => ({
      monthId: created.id,
      categoryId: category.id,
      assignedCents: 0,
    })),
  });
  return created.id;
}

/**
 * Record a manual transaction: validates through the engine (amount, category
 * requirement, month coverage, externalId dedupe), persists the row, and
 * returns the recomputed availability for the affected month.
 */
export async function recordManualTransaction(
  db: TransactionalDb,
  householdId: string,
  input: ManualTransactionInput,
): Promise<RecordedTransaction> {
  return db.$transaction(async (tx) => {
    const monthId = await ensureMonthCovers(tx, householdId, input.date);

    const before = await loadHouseholdEngineState(tx, householdId);
    const engine = createBudgetEngine(before);

    const categoryAvailability = engine.recordTransaction({
      accountId: input.accountId,
      kind: input.kind,
      amountCents: input.amountCents,
      date: input.date,
      payee: input.payee,
      categoryId: input.categoryId,
      note: input.note,
      externalId: input.externalId,
      pending: input.pending,
      reviewState: input.reviewState ?? "CONFIRMED",
    });

    const after = engine.snapshot();
    const delta = diffEngineStates(before, after);
    await persistEngineDelta(tx, householdId, delta);

    const transaction = delta.transactionsToCreate[0];
    if (!transaction) {
      // recordTransaction validated and returned availability, so its new row
      // must be in the delta; an empty one means a diff bug — refuse to
      // silently write nothing.
      throw new Error("engine recorded a transaction but the delta is empty");
    }
    return {
      transaction,
      monthId,
      categoryAvailability,
      readyToAssignCents: engine.readyToAssignCents(monthId),
    };
  });
}

export interface HouseholdTransferInput {
  fromAccountId: string;
  toAccountId: string;
  /** Positive: moves out of `fromAccountId` into `toAccountId`. */
  amountCents: number;
  date: string | Date;
  payee: string;
}

export interface RecordedTransfer {
  transferId: string;
  /** Derived balance for every household account, after the move. */
  accountBalances: { accountId: string; balanceCents: number }[];
}

/**
 * General two-account move — credit-card payment, bank→cash withdrawal,
 * settling a goal. Zero categories, zero month cashflow: the engine enforces
 * it by construction (a Transfer has no categoryId), the persisted row has no
 * month, and only the two balances move.
 */
export async function recordHouseholdTransfer(
  db: TransactionalDb,
  householdId: string,
  input: HouseholdTransferInput,
): Promise<RecordedTransfer> {
  return db.$transaction(async (tx) => {
    const before = await loadHouseholdEngineState(tx, householdId);
    const engine = createBudgetEngine(before);

    const transferId = engine.recordTransfer({
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amountCents: input.amountCents,
      date: input.date,
      payee: input.payee,
    });

    const after = engine.snapshot();
    await persistEngineDelta(
      tx,
      householdId,
      diffEngineStates(before, after),
    );

    return {
      transferId,
      accountBalances: after.accounts.map((account) => ({
        accountId: account.id,
        balanceCents: engine.accountBalanceCents(account.id),
      })),
    };
  });
}

export interface WithdrawToCashInput {
  fromAccountId: string;
  amountCents: number;
  date: string | Date;
}

/**
 * The spec's named bank→cash op: the engine picks the household's cash wallet
 * as the destination and labels the movement "ATM withdrawal".
 */
export async function withdrawToCashWallet(
  db: TransactionalDb,
  householdId: string,
  input: WithdrawToCashInput,
): Promise<RecordedTransfer> {
  return db.$transaction(async (tx) => {
    const before = await loadHouseholdEngineState(tx, householdId);
    const engine = createBudgetEngine(before);

    const transferId = engine.withdrawToCash(
      input.fromAccountId,
      input.amountCents,
      input.date,
    );

    const after = engine.snapshot();
    await persistEngineDelta(
      tx,
      householdId,
      diffEngineStates(before, after),
    );

    return {
      transferId,
      accountBalances: after.accounts.map((account) => ({
        accountId: account.id,
        balanceCents: engine.accountBalanceCents(account.id),
      })),
    };
  });
}
