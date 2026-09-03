/**
 * Funds repository (D8) — sinking/static funds wired end-to-end through the
 * engine:
 *
 *   hydrate household state → engine draw op → diff snapshot → persist rows
 *
 * Draws run inside one Prisma transaction, so a rejected draw leaves no
 * partial rows. Contributions and fund creation are ledger writes on the Fund
 * row (the spec models `balanceCents` as "contributions − payouts +
 * adjustments"); payouts are engine ops so the money semantics live in
 * exactly one place.
 */

import type { FundKind } from "@prisma/client";

import {
  createBudgetEngine,
  type CategoryAvailable,
  type MonthCashflow,
} from "@/src/engine";

import { RepositoryError } from "./errors";
import {
  calendarDateToDate,
  diffEngineStates,
  loadHouseholdEngineState,
  persistEngineDelta,
  type Db,
  type TransactionalDb,
} from "./engine-state";
import { ensureMonthCovers } from "./transactions";

// ─── Fund board read view ────────────────────────────────────────────────────

export interface FundBoardDraw {
  id: string;
  /** "September 2026" — the month the draw reports under. */
  monthLabel: string;
  amountCents: number;
  /** True when a pop-up expense consumed the draw (sinking funds). */
  paidExpense: boolean;
  /** Payee of the pop-up expense, when paidExpense. */
  expensePayee?: string;
}

export interface FundBoardEntry {
  id: string;
  kind: FundKind;
  name: string;
  targetCents?: number;
  targetDate?: string;
  balanceCents: number;
  /** Category the fund backs; pop-up expenses post against it. */
  companionCategory: { id: string; name: string } | null;
  /** Most recent draws first — the board's "popped up" history. */
  draws: FundBoardDraw[];
}

export interface FundBoardMonth {
  /** Null when no budget month exists for the current calendar month yet. */
  monthId: string | null;
  label: string;
  incomeReceivedCents: number;
  /** "Popped up" — fund draws released this month. */
  fundDrawCents: number;
  spendingCents: number;
  netCashflowCents: number;
}

export interface FundBoard {
  funds: FundBoardEntry[];
  month: FundBoardMonth;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
] as const;

function monthLabelOf(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export async function listFundBoard(
  db: Db,
  householdId: string,
): Promise<FundBoard> {
  const state = await loadHouseholdEngineState(db, householdId);
  const engine = createBudgetEngine(state);

  const now = new Date();
  const current = state.months.find(
    (m) => m.year === now.getFullYear() && m.month === now.getMonth() + 1,
  );
  const month: FundBoardMonth = current
    ? {
        ...engine.monthCashflow(current.id),
        monthId: current.id,
        label: monthLabelOf(current.year, current.month),
      }
    : {
        monthId: null,
        label: monthLabelOf(now.getFullYear(), now.getMonth() + 1),
        incomeReceivedCents: 0,
        fundDrawCents: 0,
        spendingCents: 0,
        netCashflowCents: 0,
      };

  const funds: FundBoardEntry[] = state.funds.map((fund) => {
    const companion = state.categories.find((c) => c.fundId === fund.id);
    const draws = state.fundDraws
      .filter((d) => d.fundId === fund.id)
      .map((d): { draw: FundBoardDraw; sortKey: number } => {
        const drawMonth = state.months.find((m) => m.id === d.monthId);
        const expense = state.transactions.find((t) => t.fundDrawId === d.id);
        return {
          draw: {
            id: d.id,
            monthLabel: drawMonth
              ? monthLabelOf(drawMonth.year, drawMonth.month)
              : "Unplanned month",
            amountCents: d.amountCents,
            paidExpense: expense !== undefined,
            expensePayee: expense?.payee,
          },
          sortKey: drawMonth ? drawMonth.year * 12 + drawMonth.month : 0,
        };
      })
      .sort((a, b) => b.sortKey - a.sortKey)
      .map(({ draw }) => draw);

    return {
      id: fund.id,
      kind: fund.kind,
      name: fund.name,
      targetCents: fund.targetCents,
      targetDate: fund.targetDate,
      balanceCents: fund.balanceCents,
      companionCategory: companion
        ? { id: companion.id, name: companion.name }
        : null,
      draws,
    };
  });

  return { funds, month };
}

// ─── Create ──────────────────────────────────────────────────────────────────

export interface CreateFundInput {
  kind: FundKind;
  name: string;
  targetCents?: number;
  /** Household-local calendar date ("YYYY-MM-DD"). */
  targetDate?: string;
  /** Link an existing category to back the fund; sinking funds auto-create one otherwise. */
  companionCategoryId?: string;
}

/**
 * Create a fund in the household. A sinking fund always ends up with a
 * companion category (its pop-up expenses post against it): link the chosen
 * category, or auto-create one named after the fund under Savings & Debts.
 */
export async function createFund(
  db: TransactionalDb,
  householdId: string,
  input: CreateFundInput,
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw new RepositoryError("INVALID_NAME", "Name the fund.");
  if (input.targetCents != null && input.targetCents <= 0) {
    throw new RepositoryError(
      "INVALID_TARGET",
      "Target must be greater than zero.",
    );
  }

  return db.$transaction(async (tx) => {
    let companionCategoryId = input.companionCategoryId;
    if (companionCategoryId) {
      const owned = await tx.category.findFirst({
        where: { id: companionCategoryId, householdId, fundId: null },
        select: { id: true },
      });
      if (!owned) {
        throw new RepositoryError(
          "CATEGORY_ALREADY_FUNDED",
          "That category doesn't exist here, or already has a fund.",
        );
      }
    } else if (input.kind === "SINKING") {
      const created = await tx.category.create({
        data: { householdId, group: "SAVINGS_DEBTS", name },
        select: { id: true },
      });
      companionCategoryId = created.id;
    }

    const fund = await tx.fund.create({
      data: {
        householdId,
        kind: input.kind,
        name,
        targetCents: input.targetCents,
        targetDate: input.targetDate
          ? calendarDateToDate(input.targetDate)
          : null,
        balanceCents: 0,
      },
      select: { id: true },
    });

    if (companionCategoryId) {
      await tx.category.update({
        where: { id: companionCategoryId },
        data: { fundId: fund.id },
      });
    }

    return { id: fund.id };
  });
}

// ─── Contribute ──────────────────────────────────────────────────────────────

/** Add money to a fund's balance — a contribution on the fund's own ledger. */
export async function contributeToFund(
  db: Db,
  householdId: string,
  input: { fundId: string; amountCents: number },
): Promise<{ balanceCents: number }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new RepositoryError(
      "INVALID_AMOUNT",
      "Contribution must be greater than zero.",
    );
  }
  await requireOwnedFund(db, householdId, input.fundId);

  const fund = await db.fund.update({
    where: { id: input.fundId },
    data: { balanceCents: { increment: input.amountCents } },
    select: { balanceCents: true },
  });
  return { balanceCents: fund.balanceCents };
}

// ─── Draws (engine ops, persisted) ───────────────────────────────────────────

export interface PopupDrawInput {
  fundId: string;
  /** Account the expense is paid from — card or cash. */
  accountId: string;
  /** Positive magnitude; recorded as money out of the fund and the account. */
  amountCents: number;
  /** Household-local calendar date ("YYYY-MM-DD"); picks the month. */
  date: string;
  payee: string;
  note?: string;
}

export interface RecordedFundDraw {
  drawId: string;
  monthId: string;
  fundBalanceCents: number;
  monthCashflow: MonthCashflow;
  /** Availability for every category in the affected month, after the draw. */
  categoryAvailability: CategoryAvailable[];
  readyToAssignCents: number;
}

/**
 * Sinking-fund pop-up through the engine: fund −, expense posts against the
 * companion category, month's cashflow released +. Never touches Ready to
 * Assign — a draw is cashflow, never income.
 */
export async function recordPopupDraw(
  db: TransactionalDb,
  householdId: string,
  input: PopupDrawInput,
): Promise<RecordedFundDraw> {
  return db.$transaction(async (tx) => {
    const monthId = await ensureMonthCovers(tx, householdId, input.date);

    const before = await loadHouseholdEngineState(tx, householdId);
    const engine = createBudgetEngine(before);

    const drawId = engine.drawFromFund(input.fundId, {
      accountId: input.accountId,
      kind: "EXPENSE",
      // The engine takes the signed expense; the form collects a magnitude.
      amountCents: -input.amountCents,
      date: input.date,
      payee: input.payee,
      note: input.note,
      reviewState: "CONFIRMED",
    });

    const after = engine.snapshot();
    await persistEngineDelta(
      tx,
      householdId,
      diffEngineStates(before, after),
    );

    const fund = after.funds.find((f) => f.id === input.fundId);
    if (!fund) {
      throw new Error("engine drew from a fund missing from the snapshot");
    }
    return {
      drawId,
      monthId,
      fundBalanceCents: fund.balanceCents,
      monthCashflow: engine.monthCashflow(monthId),
      categoryAvailability: engine.categoryAvailable(monthId),
      readyToAssignCents: engine.readyToAssignCents(monthId),
    };
  });
}

export interface StaticDrawInput {
  fundId: string;
  /** Positive magnitude drawn out of the static goal. */
  amountCents: number;
  /** Household-local calendar date ("YYYY-MM-DD"); picks the month. */
  date: string;
}

/**
 * Static-goal draw through the engine: the goal moves only on an explicit
 * draw, which reports as "popped up" for the month — no income, no category,
 * no Ready to Assign change.
 */
export async function recordStaticDraw(
  db: TransactionalDb,
  householdId: string,
  input: StaticDrawInput,
): Promise<RecordedFundDraw> {
  return db.$transaction(async (tx) => {
    const monthId = await ensureMonthCovers(tx, householdId, input.date);

    const before = await loadHouseholdEngineState(tx, householdId);
    const engine = createBudgetEngine(before);

    const drawId = engine.drawFromStaticGoal(
      input.fundId,
      input.amountCents,
      monthId,
    );

    const after = engine.snapshot();
    await persistEngineDelta(
      tx,
      householdId,
      diffEngineStates(before, after),
    );

    const fund = after.funds.find((f) => f.id === input.fundId);
    if (!fund) {
      throw new Error("engine drew from a fund missing from the snapshot");
    }
    return {
      drawId,
      monthId,
      fundBalanceCents: fund.balanceCents,
      monthCashflow: engine.monthCashflow(monthId),
      categoryAvailability: engine.categoryAvailable(monthId),
      readyToAssignCents: engine.readyToAssignCents(monthId),
    };
  });
}

/** Throws NOT_FOUND unless the fund exists inside this household. */
async function requireOwnedFund(
  db: Db,
  householdId: string,
  fundId: string,
): Promise<void> {
  const owned = await db.fund.findFirst({
    where: { id: fundId, householdId },
    select: { id: true },
  });
  if (!owned) {
    throw new RepositoryError(
      "NOT_FOUND",
      "That fund doesn't exist for your household.",
    );
  }
}
