/**
 * Accounts repository — CRUD scoped to one household (D4). Balances are never
 * stored: they derive from startingCents + transactions + transfers via the
 * engine, so the ledger stays the single source of truth.
 */

import type { AccountKind } from "@prisma/client";

import { createBudgetEngine } from "@/src/engine";

import { RepositoryError } from "./errors";
import { loadHouseholdEngineState, type Db } from "./engine-state";

export interface AccountWithBalance {
  id: string;
  kind: AccountKind;
  name: string;
  startingCents: number;
  balanceCents: number;
}

/** Every account with its engine-derived balance, most recently created last. */
export async function listAccountsWithBalances(
  db: Db,
  householdId: string,
): Promise<AccountWithBalance[]> {
  const state = await loadHouseholdEngineState(db, householdId);
  const engine = createBudgetEngine(state);
  return state.accounts.map((account) => ({
    id: account.id,
    kind: account.kind,
    name: account.name,
    startingCents: account.startingCents,
    balanceCents: engine.accountBalanceCents(account.id),
  }));
}

export interface CreateAccountInput {
  kind: AccountKind;
  name: string;
  startingCents: number;
}

/** Create an account in the household. Returns its id. */
export async function createAccount(
  db: Db,
  householdId: string,
  input: CreateAccountInput,
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) {
    throw new RepositoryError("INVALID_NAME", "Name the account.");
  }
  const account = await db.account.create({
    data: {
      householdId,
      kind: input.kind,
      name,
      startingCents: input.startingCents,
    },
    select: { id: true },
  });
  return { id: account.id };
}

export interface UpdateAccountInput {
  kind?: AccountKind;
  name?: string;
  startingCents?: number;
}

/**
 * Update an owned account. Throws NOT_FOUND when the id belongs to another
 * household — same signal a missing row gives, never leak existence.
 */
export async function updateAccount(
  db: Db,
  householdId: string,
  accountId: string,
  input: UpdateAccountInput,
): Promise<void> {
  await requireOwnedAccount(db, householdId, accountId);
  await db.account.update({
    where: { id: accountId },
    data: {
      kind: input.kind,
      name: input.name === undefined ? undefined : input.name.trim(),
      startingCents: input.startingCents,
    },
  });
}

/**
 * Delete an owned account. An account with history is refused, not cascaded:
 * deleting its transactions would rewrite category availability and the
 * ledger would no longer tell the truth.
 */
export async function deleteAccount(
  db: Db,
  householdId: string,
  accountId: string,
): Promise<void> {
  await requireOwnedAccount(db, householdId, accountId);

  const [transactionCount, transferCount] = await Promise.all([
    db.transaction.count({ where: { accountId } }),
    db.transfer.count({
      where: { OR: [{ fromAccountId: accountId }, { toAccountId: accountId }] },
    }),
  ]);
  if (transactionCount + transferCount > 0) {
    throw new RepositoryError(
      "ACCOUNT_IN_USE",
      "This account has transactions. Money history stays put — it can't be deleted.",
    );
  }

  await db.account.delete({ where: { id: accountId } });
}

/** Throws NOT_FOUND unless the account exists inside this household. */
export async function requireOwnedAccount(
  db: Db,
  householdId: string,
  accountId: string,
): Promise<void> {
  const owned = await db.account.findFirst({
    where: { id: accountId, householdId },
    select: { id: true },
  });
  if (!owned) {
    throw new RepositoryError(
      "NOT_FOUND",
      "That account doesn't exist for your household.",
    );
  }
}
