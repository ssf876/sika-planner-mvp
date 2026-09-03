/**
 * Hydration layer between the pure budget engine (src/engine) and Prisma —
 * the only place the two meet.
 *
 *   loadHouseholdEngineState  Prisma rows → EngineState (household-scoped)
 *   diffEngineStates          before/after snapshots → EngineStateDelta
 *   persistEngineDelta        EngineStateDelta → rows, inside the caller's tx
 *
 * The engine never imports Prisma (D2); every engine op is applied as
 * hydrate → op → snapshot → diff → persist, so the money semantics live in
 * exactly one place and persistence stays mechanical.
 */

import type {
  Prisma,
  PrismaClient,
  AccountKind,
  CategoryGroup,
  FundKind,
  ReviewState,
  TxKind,
} from "@prisma/client";

import type {
  Allocation,
  EngineState,
  Fund,
  FundDraw,
  Transaction,
  Transfer,
} from "@/src/engine";

/**
 * Any Prisma handle — the plain client or a transaction client. Read and
 * write helpers accept either; only op entry points open transactions.
 */
export type Db = PrismaClient | Prisma.TransactionClient;

/** A handle that can open a transaction (a transaction client cannot nest). */
export type TransactionalDb = PrismaClient;

/** Engine dates are household-local "YYYY-MM-DD" strings (spec A4). */
export function calendarDateToDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function dateToCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Load one household's budget as engine state. Only this household's rows are
 * ever queried, so engine ops on ids outside the household fail with
 * UNKNOWN_* — hydration is itself the tenancy boundary.
 */
export async function loadHouseholdEngineState(
  db: Db,
  householdId: string,
): Promise<EngineState> {
  const [
    accounts,
    categories,
    months,
    allocations,
    transactions,
    funds,
    fundDraws,
    transfers,
  ] = await Promise.all([
    db.account.findMany({ where: { householdId } }),
    db.category.findMany({ where: { householdId } }),
    db.month.findMany({ where: { householdId } }),
    db.allocation.findMany({ where: { month: { householdId } } }),
    db.transaction.findMany({ where: { account: { householdId } } }),
    db.fund.findMany({ where: { householdId } }),
    db.fundDraw.findMany({ where: { fund: { householdId } } }),
    db.transfer.findMany({ where: { householdId } }),
  ]);

  return {
    householdId,
    accounts: accounts.map((a) => ({
      id: a.id,
      householdId: a.householdId,
      kind: a.kind as AccountKind,
      name: a.name,
      startingCents: a.startingCents,
    })),
    categories: categories.map((c) => ({
      id: c.id,
      householdId: c.householdId,
      group: c.group as CategoryGroup,
      name: c.name,
      fundId: c.fundId ?? undefined,
    })),
    months: months.map((m) => ({
      id: m.id,
      householdId: m.householdId,
      year: m.year,
      month: m.month,
      expectedIncomeCents: m.expectedIncomeCents,
    })),
    allocations: allocations.map((a) => ({
      monthId: a.monthId,
      categoryId: a.categoryId,
      assignedCents: a.assignedCents,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      categoryId: t.categoryId ?? undefined,
      fundDrawId: t.fundDrawId ?? undefined,
      kind: t.kind as TxKind,
      amountCents: t.amountCents,
      date: dateToCalendarDate(t.date),
      payee: t.payee,
      note: t.note ?? undefined,
      externalId: t.externalId ?? undefined,
      pending: t.pending,
      reviewState: t.reviewState as ReviewState,
    })),
    funds: funds.map(
      (f): Fund => ({
        id: f.id,
        householdId: f.householdId,
        kind: f.kind as FundKind,
        name: f.name,
        targetCents: f.targetCents ?? undefined,
        targetDate: f.targetDate
          ? dateToCalendarDate(f.targetDate)
          : undefined,
        balanceCents: f.balanceCents,
      }),
    ),
    fundDraws: fundDraws.map((d) => ({
      id: d.id,
      fundId: d.fundId,
      monthId: d.monthId,
      amountCents: d.amountCents,
    })),
    transfers: transfers.map(
      (t): Transfer => ({
        id: t.id,
        fromAccountId: t.fromAccountId,
        toAccountId: t.toAccountId,
        amountCents: t.amountCents,
        date: dateToCalendarDate(t.date),
        payee: t.payee,
      }),
    ),
  };
}

// ─── Delta computation ───────────────────────────────────────────────────────

export interface EngineStateDelta {
  transactionsToCreate: Transaction[];
  fundDrawsToCreate: FundDraw[];
  transfersToCreate: Transfer[];
  fundBalanceUpdates: { id: string; balanceCents: number }[];
  allocationUpserts: Allocation[];
  allocationDeletes: { monthId: string; categoryId: string }[];
}

const allocationKey = (a: { monthId: string; categoryId: string }): string =>
  `${a.monthId}:${a.categoryId}`;

/**
 * What one engine op changed. Engine ops only add rows and adjust fund
 * balances/allocations — never edit or delete transactions — so comparing
 * before/after snapshots by id (and by allocation key) yields the exact
 * writes, whichever op ran.
 */
export function diffEngineStates(
  before: EngineState,
  after: EngineState,
): EngineStateDelta {
  const beforeTxIds = new Set(before.transactions.map((t) => t.id));
  const beforeDrawIds = new Set(before.fundDraws.map((d) => d.id));
  const beforeTransferIds = new Set(before.transfers.map((t) => t.id));

  const beforeBalances = new Map(
    before.funds.map((f) => [f.id, f.balanceCents] as const),
  );

  const beforeAllocations = new Map(
    before.allocations.map((a) => [allocationKey(a), a] as const),
  );
  const afterAllocations = new Map(
    after.allocations.map((a) => [allocationKey(a), a] as const),
  );

  const allocationUpserts: Allocation[] = [];
  const allocationDeletes: { monthId: string; categoryId: string }[] = [];

  for (const a of afterAllocations.values()) {
    const previous = beforeAllocations.get(allocationKey(a));
    if (previous) {
      if (previous.assignedCents !== a.assignedCents) allocationUpserts.push(a);
    } else if (a.assignedCents !== 0) {
      // Engine ops remove zeroed allocations instead of storing them.
      allocationUpserts.push(a);
    }
  }
  for (const a of beforeAllocations.values()) {
    if (!afterAllocations.has(allocationKey(a))) {
      allocationDeletes.push({ monthId: a.monthId, categoryId: a.categoryId });
    }
  }

  return {
    transactionsToCreate: after.transactions.filter(
      (t) => !beforeTxIds.has(t.id),
    ),
    fundDrawsToCreate: after.fundDraws.filter((d) => !beforeDrawIds.has(d.id)),
    transfersToCreate: after.transfers.filter(
      (t) => !beforeTransferIds.has(t.id),
    ),
    fundBalanceUpdates: after.funds
      .filter((f) => beforeBalances.get(f.id) !== f.balanceCents)
      .map((f) => ({ id: f.id, balanceCents: f.balanceCents })),
    allocationUpserts,
    allocationDeletes,
  };
}

// ─── Delta persistence ───────────────────────────────────────────────────────

/**
 * Write one engine op's effects. Call inside db.$transaction alongside the op
 * so a failure rolls back the whole move (engine validation included).
 */
export async function persistEngineDelta(
  db: Db,
  householdId: string,
  delta: EngineStateDelta,
): Promise<void> {
  if (delta.transactionsToCreate.length > 0) {
    await db.transaction.createMany({
      data: delta.transactionsToCreate.map((t) => ({
        id: t.id,
        accountId: t.accountId,
        categoryId: t.categoryId ?? null,
        fundDrawId: t.fundDrawId ?? null,
        kind: t.kind,
        amountCents: t.amountCents,
        date: calendarDateToDate(t.date),
        payee: t.payee,
        note: t.note ?? null,
        externalId: t.externalId ?? null,
        pending: t.pending,
        reviewState: t.reviewState,
      })),
    });
  }

  if (delta.fundDrawsToCreate.length > 0) {
    await db.fundDraw.createMany({
      data: delta.fundDrawsToCreate.map((d) => ({
        id: d.id,
        fundId: d.fundId,
        monthId: d.monthId,
        amountCents: d.amountCents,
      })),
    });
  }

  if (delta.transfersToCreate.length > 0) {
    await db.transfer.createMany({
      data: delta.transfersToCreate.map((t) => ({
        id: t.id,
        householdId,
        fromAccountId: t.fromAccountId,
        toAccountId: t.toAccountId,
        amountCents: t.amountCents,
        date: calendarDateToDate(t.date),
        payee: t.payee,
      })),
    });
  }

  for (const fund of delta.fundBalanceUpdates) {
    await db.fund.update({
      where: { id: fund.id },
      data: { balanceCents: fund.balanceCents },
    });
  }

  for (const a of delta.allocationUpserts) {
    await db.allocation.upsert({
      where: {
        monthId_categoryId: { monthId: a.monthId, categoryId: a.categoryId },
      },
      create: {
        monthId: a.monthId,
        categoryId: a.categoryId,
        assignedCents: a.assignedCents,
      },
      update: { assignedCents: a.assignedCents },
    });
  }

  for (const a of delta.allocationDeletes) {
    await db.allocation.deleteMany({
      where: { monthId: a.monthId, categoryId: a.categoryId },
    });
  }
}
