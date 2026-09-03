/**
 * Planner repository (D6): zero-based assignment and copy-previous-month.
 *
 * Every op follows the house pattern — hydrate → engine op → snapshot →
 * diff → persist inside one transaction — then returns the engine's
 * recomputed view so the UI renders engine truth, never local guesses.
 * Hydration is the tenancy boundary: ids outside the household fail with
 * UNKNOWN_* engine errors.
 */

import {
  createBudgetEngine,
  previousCalendarMonth,
  type CategoryAvailable,
  type CategoryGroup,
} from "@/src/engine";

import {
  diffEngineStates,
  loadHouseholdEngineState,
  persistEngineDelta,
  type TransactionalDb,
} from "./engine-state";
import { ensureMonthCovers } from "./transactions";

export interface AssignToCategoryInput {
  monthId: string;
  categoryId: string;
  /** Non-negative integer cents; 0 unassigns (engine semantics). */
  cents: number;
}

export interface AssignWindfallInput {
  monthId: string;
  categoryId: string;
  /**
   * How much MORE this category should get, not what the draft should
   * become — windfall lines are deltas (cover the shortfall, toward the
   * goal), unlike the grid's absolute assignment and D12 season proposals.
   */
  deltaCents: number;
}

export interface PlannerOpResult {
  readyToAssignCents: number;
  /** Availability for every category in the month, after the op. */
  availability: CategoryAvailable[];
}

/**
 * One zero-based assignment (D6). This is also the apply path for advisor
 * proposals (D12): an applied line flows through the same engine.assign —
 * nothing about a proposal mutates until the user confirms and the action
 * calls this.
 */
export async function assignToCategory(
  db: TransactionalDb,
  householdId: string,
  input: AssignToCategoryInput,
): Promise<PlannerOpResult> {
  return db.$transaction(async (tx) => {
    const before = await loadHouseholdEngineState(tx, householdId);
    const engine = createBudgetEngine(before);

    engine.assign(input.monthId, input.categoryId, input.cents);

    await persistEngineDelta(
      tx,
      householdId,
      diffEngineStates(before, engine.snapshot()),
    );

    return {
      readyToAssignCents: engine.readyToAssignCents(input.monthId),
      availability: engine.categoryAvailable(input.monthId),
    };
  });
}

/**
 * Apply one windfall line to a category (D13). Windfall suggestions are
 * deltas — "cover the shortfall", "toward the goal" — so the line adds to
 * the draft the month already has instead of replacing it (engine.assign is
 * set-semantics; the grid and D12 season proposals feed it absolute
 * amounts, so they keep using assignToCategory).
 */
export async function assignWindfallToCategory(
  db: TransactionalDb,
  householdId: string,
  input: AssignWindfallInput,
): Promise<PlannerOpResult> {
  return db.$transaction(async (tx) => {
    const before = await loadHouseholdEngineState(tx, householdId);
    const engine = createBudgetEngine(before);

    const currentDraftCents =
      before.allocations.find(
        (allocation) =>
          allocation.monthId === input.monthId &&
          allocation.categoryId === input.categoryId,
      )?.assignedCents ?? 0;
    engine.assign(
      input.monthId,
      input.categoryId,
      currentDraftCents + input.deltaCents,
    );

    await persistEngineDelta(
      tx,
      householdId,
      diffEngineStates(before, engine.snapshot()),
    );

    return {
      readyToAssignCents: engine.readyToAssignCents(input.monthId),
      availability: engine.categoryAvailable(input.monthId),
    };
  });
}

/**
 * "Start from last month, then edit" (D6): copies every non-zero previous-
 * month allocation into the current month. Fails with PREVIOUS_MONTH_MISSING
 * when no prior month exists — the caller surfaces a friendly message.
 */
export async function copyPreviousMonthPlan(
  db: TransactionalDb,
  householdId: string,
  monthId: string,
): Promise<PlannerOpResult> {
  return db.$transaction(async (tx) => {
    const before = await loadHouseholdEngineState(tx, householdId);
    const engine = createBudgetEngine(before);

    engine.copyPreviousMonth(monthId);

    await persistEngineDelta(
      tx,
      householdId,
      diffEngineStates(before, engine.snapshot()),
    );

    return {
      readyToAssignCents: engine.readyToAssignCents(monthId),
      availability: engine.categoryAvailable(monthId),
    };
  });
}

export interface PlannerSnapshot {
  monthId: string;
  year: number;
  /** 1–12. */
  month: number;
  /** Income transactions received this month — the only RTA input (fund draws are cashflow, never income). */
  incomeReceivedCents: number;
  readyToAssignCents: number;
  /** False when no prior month exists to copy from. */
  hasPreviousMonth: boolean;
  categories: { id: string; name: string; group: CategoryGroup }[];
  availability: CategoryAvailable[];
}

/**
 * Everything the planner screen renders, computed by the engine: find-or-
 * scaffold the month covering `today`, then read cashflow, Ready to Assign,
 * and per-category availability from the hydrated state.
 */
export async function getPlannerSnapshot(
  db: TransactionalDb,
  householdId: string,
  today: string,
): Promise<PlannerSnapshot> {
  const monthId = await ensureMonthCovers(db, householdId, today);
  const state = await loadHouseholdEngineState(db, householdId);
  const engine = createBudgetEngine(state);

  const month = state.months.find((m) => m.id === monthId);
  if (!month) {
    // Unreachable — ensureMonthCovers just created or found it — but the
    // narrowing keeps the return honest instead of asserting.
    throw new Error(`planner: month ${monthId} missing after scaffolding`);
  }
  const previous = previousCalendarMonth(month.year, month.month);

  return {
    monthId,
    year: month.year,
    month: month.month,
    incomeReceivedCents: engine.monthCashflow(monthId).incomeReceivedCents,
    readyToAssignCents: engine.readyToAssignCents(monthId),
    hasPreviousMonth: state.months.some(
      (m) => m.year === previous.year && m.month === previous.month,
    ),
    categories: state.categories.map(({ id, name, group }) => ({
      id,
      name,
      group,
    })),
    availability: engine.categoryAvailable(monthId),
  };
}
