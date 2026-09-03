/**
 * Windfall advisor persistence (D13) — hydrates the pure advisor's inputs
 * from household state. Ranking stays in lib/planner/windfall.ts (pure);
 * this layer only maps rows, resolves the active goal, and reads the
 * household's risk appetite.
 *
 * Tenancy: everything loads through household-scoped queries, so ids outside
 * the household are invisible and the engine's UNKNOWN_* errors still guard
 * the apply path.
 */

import type { GoalKind } from "@prisma/client";

import {
  calendarMonth,
  createBudgetEngine,
  type Category,
} from "@/src/engine";
import {
  detectWindfallIncome,
  rankWindfallAllocation,
  type WindfallCategoryInput,
  type WindfallDetection,
  type WindfallFundInput,
  type WindfallGoalInput,
  type WindfallIncomeRow,
  type WindfallProposal,
  type WindfallRankContext,
} from "@/lib/planner/windfall";

import type { Db } from "./engine-state";
import { loadHouseholdEngineState } from "./engine-state";
import { listGoals } from "./goals";

/**
 * v1 goal→category mapping: an applied goal line assigns into the
 * onboarding category that matches the goal's kind (onboarding seeds
 * "Debt Payoff" and "Savings & Funds" under SAVINGS_DEBTS). There is no
 * goal→category link in the v1 schema, so the mapping is name-based over the
 * household's real categories and degrades to a guidance-only line when the
 * household renamed or removed them.
 */
const GOAL_KIND_CATEGORY_NAME: Record<GoalKind, string> = {
  PAYOFF_DEBT: "Debt Payoff",
  GROW_NET_WORTH: "Savings & Funds",
  CUSTOM: "Savings & Funds",
};

function resolveGoalCategory(
  categories: Category[],
  kind: GoalKind,
): string | undefined {
  return categories.find((c) => c.name === GOAL_KIND_CATEGORY_NAME[kind])?.id;
}

export interface WindfallContext {
  monthId: string;
  expectedIncomeCents: number;
  /** The month's income transactions, in date order. */
  incomeRows: WindfallIncomeRow[];
  detection: WindfallDetection;
  /** Everything the pure ranker needs — the banner ranks from this on every render. */
  rankContext: WindfallRankContext;
}

function sameCalendarMonth(
  date: string,
  target: { year: number; month: number },
): boolean {
  const { year, month } = calendarMonth(date);
  return year === target.year && month === target.month;
}

/**
 * Everything the planner's Allocate banner renders, computed from live
 * state: the month's income rows and the A7 detection over them, plus the
 * ranking inputs (categories with availability, funds with this month's
 * planned funding, the active goal, the household's risk appetite).
 */
export async function getWindfallContext(
  db: Db,
  householdId: string,
  monthId: string,
): Promise<WindfallContext> {
  const [state, household] = await Promise.all([
    loadHouseholdEngineState(db, householdId),
    db.household.findUniqueOrThrow({
      where: { id: householdId },
      select: { riskAppetite: true },
    }),
  ]);
  const engine = createBudgetEngine(state);

  const month = state.months.find((m) => m.id === monthId);
  if (!month) {
    // The planner scaffolds the month before this runs; anything else is a
    // caller bug and should be loud, not a guessed proposal.
    throw new Error(`windfall: month "${monthId}" missing for this household`);
  }
  const asOf = { year: month.year, month: month.month };

  const incomeRows: WindfallIncomeRow[] = state.transactions
    .filter((tx) => tx.kind === "INCOME" && sameCalendarMonth(tx.date, asOf))
    .map((tx) => ({
      transactionId: tx.id,
      payee: tx.payee,
      amountCents: tx.amountCents,
      date: tx.date,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const detection = detectWindfallIncome(
    incomeRows,
    month.expectedIncomeCents,
  );

  const categories: WindfallCategoryInput[] = engine
    .categoryAvailable(monthId)
    .map((row) => ({
      categoryId: row.categoryId,
      name:
        state.categories.find((c) => c.id === row.categoryId)?.name ??
        row.categoryId,
      availableCents: row.availableCents,
    }));

  const funds: WindfallFundInput[] = state.funds.map((fund) => {
    const companion = state.categories.find((c) => c.fundId === fund.id);
    const plannedThisMonthCents = companion
      ? (state.allocations.find(
          (a) => a.monthId === monthId && a.categoryId === companion.id,
        )?.assignedCents ?? 0)
      : null;
    return {
      fundId: fund.id,
      name: fund.name,
      kind: fund.kind,
      targetCents: fund.targetCents,
      targetDate: fund.targetDate,
      balanceCents: fund.balanceCents,
      plannedThisMonthCents,
    };
  });

  // listGoals orders active first; the spec's rank-3 target is the one
  // active goal onboarding seeds.
  const goals = await listGoals(db, householdId);
  const activeGoal = goals.find((g) => g.active) ?? null;
  const goal: WindfallGoalInput | null = activeGoal
    ? {
        goalId: activeGoal.id,
        name: activeGoal.name,
        kind: activeGoal.kind,
        targetCents: activeGoal.targetCents,
        suggestedCategoryId: resolveGoalCategory(
          state.categories,
          activeGoal.kind,
        ),
      }
    : null;

  return {
    monthId,
    expectedIncomeCents: month.expectedIncomeCents,
    incomeRows,
    detection,
    rankContext: {
      monthId,
      asOf,
      riskAppetite: household.riskAppetite,
      categories,
      funds,
      goal,
    },
  };
}

/**
 * The spec's Advisor op (D13): rank a windfall from live state — computed
 * fresh, never stored. The planner banner ranks client-side from
 * getWindfallContext's inputs; this composition exists for server callers
 * and as the tested seam for goal-change re-rank.
 */
export async function proposeWindfallAllocation(
  db: Db,
  householdId: string,
  monthId: string,
  windfallCents: number,
): Promise<WindfallProposal> {
  const context = await getWindfallContext(db, householdId, monthId);
  return rankWindfallAllocation(context.rankContext, windfallCents);
}
