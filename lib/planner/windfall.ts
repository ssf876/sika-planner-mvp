/**
 * The windfall advisor (spec D13 + A7) — detection and the ranked proposal.
 *
 * Two ways in: an income transaction that pushes the month past its expected
 * income is auto-flagged (the A7 heuristic), and any income row offers an
 * "Allocate" action regardless. The proposal is a ranked waterfall over live
 * state — overspent categories → sinking funds behind their target date →
 * the active goal weighted by risk appetite → remainder stays in Ready to
 * Assign — computed fresh on every call and never stored, so an edited goal
 * or a new fund re-ranks it with no stale data (A7).
 *
 * Pure module: no DB, no framework. The repository layer hydrates the inputs
 * and the Allocate banner ranks client-side so the ranking re-runs on every
 * render.
 */

import type { FundKind, FundPace, RiskAppetite } from "@/src/engine";
import {
  assertIntegerCents,
  assessFundPace,
  computeFundPace,
  DEFAULT_DANGER_THRESHOLDS,
} from "@/src/engine";

import type { GoalKind } from "@prisma/client";

// ─── Detection (A7: income that doesn't match the month's expected sources) ──

/** One income row the detector screens. */
export interface WindfallIncomeRow {
  transactionId: string;
  payee: string;
  /** Positive — the engine records income as signed money in. */
  amountCents: number;
  /** Household-local ISO date ("YYYY-MM-DD"). */
  date: string;
}

export interface WindfallDetection {
  /** Income beyond the month's expected total, in integer cents (0 when under). */
  windfallCents: number;
  /**
   * Deposits that carry the month's running income past its expected total,
   * in date order — the rows the auto-flag names (A7).
   */
  flaggedTransactionIds: string[];
}

/**
 * The A7 auto-flag heuristic: a windfall is income that doesn't match the
 * month's expected sources. Deterministic and explainable — a deposit is
 * flagged when the month's running total through it exceeds the month's
 * expected income, and the excess cents are the windfall. A $0-expected
 * month flags everything, which is honest: the household told us to expect
 * nothing. The manual "Allocate" action on every row is the coverage the
 * heuristic promises (A7: the flag is a convenience, never a gate).
 */
export function detectWindfallIncome(
  rows: readonly WindfallIncomeRow[],
  expectedIncomeCents: number,
): WindfallDetection {
  assertIntegerCents(expectedIncomeCents, "expectedIncomeCents");

  // Date order with a stable tiebreak, so flagging never depends on the
  // caller's row order.
  const income = rows
    .filter((row) => row.amountCents > 0)
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.date.localeCompare(b.row.date) || a.index - b.index);

  const flaggedTransactionIds: string[] = [];
  let runningCents = 0;
  for (const { row } of income) {
    runningCents += row.amountCents;
    if (runningCents > expectedIncomeCents) {
      flaggedTransactionIds.push(row.transactionId);
    }
  }

  return {
    windfallCents: Math.max(0, runningCents - expectedIncomeCents),
    flaggedTransactionIds,
  };
}

// ─── The ranked proposal (D13) ────────────────────────────────────────────────

/** Rank-1 target: a category that spent past its assignment this month. */
export interface WindfallCategoryInput {
  categoryId: string;
  name: string;
  /** Negative = overspent by this much. */
  availableCents: number;
}

/** Rank-2 target: a fund the pace math flags as behind its target date. */
export interface WindfallFundInput {
  fundId: string;
  name: string;
  kind: FundKind;
  targetCents?: number;
  targetDate?: string;
  balanceCents: number;
  /**
   * This month's planned funding (the companion category's allocation);
   * null when the fund has no companion category.
   */
  plannedThisMonthCents: number | null;
}

/** Rank-3 target: the household's active goal. */
export interface WindfallGoalInput {
  goalId: string;
  name: string;
  kind: GoalKind;
  targetCents?: number;
  /**
   * Where an applied goal line lands. The v1 schema has no goal→category
   * link, so the repository maps the goal kind onto the household's own
   * onboarding categories; undefined renders the line as guidance without an
   * Apply button — honest when nothing matches to assign into.
   */
  suggestedCategoryId?: string;
}

export interface WindfallRankContext {
  monthId: string;
  /** The month being planned — fund pace is judged as of this month. */
  asOf: { year: number; month: number };
  riskAppetite: RiskAppetite;
  categories: WindfallCategoryInput[];
  funds: WindfallFundInput[];
  /** The active goal, or null when the household has none. */
  goal: WindfallGoalInput | null;
}

/** Share of the unranked remainder the active goal may claim, per appetite. */
export const GOAL_WEIGHT_PERCENT: Record<RiskAppetite, number> = {
  CAUTIOUS: 25,
  BALANCED: 50,
  AGGRESSIVE: 100,
};

export type WindfallLine =
  | {
      kind: "category";
      lineId: string;
      categoryId: string;
      name: string;
      suggestedCents: number;
      reason?: string;
    }
  | {
      kind: "fund";
      lineId: string;
      fundId: string;
      name: string;
      suggestedCents: number;
      reason?: string;
    }
  | {
      kind: "goal";
      lineId: string;
      goalId: string;
      name: string;
      suggestedCents: number;
      suggestedCategoryId?: string;
      reason?: string;
    }
  | {
      kind: "remainder";
      lineId: string;
      suggestedCents: number;
      reason?: string;
    };

export interface WindfallProposal {
  monthId: string;
  windfallCents: number;
  riskAppetite: RiskAppetite;
  /** Ranked: category → fund → goal → remainder. Empty when there is no windfall. */
  lines: WindfallLine[];
}

const lineReasons = {
  category: "Overspent — cover the shortfall",
  fund: "Behind the pace its target date needs",
  goal: "Toward your active goal",
  remainder: "Stays flexible in Ready to Assign",
} as const;

/**
 * Rank a windfall over live state (D13). A waterfall: each rank claims what
 * it needs from what earlier ranks left, every amount is integer cents, and
 * the result is recomputed on every call — never stored.
 */
export function rankWindfallAllocation(
  context: WindfallRankContext,
  windfallCents: number,
): WindfallProposal {
  assertIntegerCents(windfallCents, "windfallCents");
  if (windfallCents <= 0) {
    return {
      monthId: context.monthId,
      windfallCents: 0,
      riskAppetite: context.riskAppetite,
      lines: [],
    };
  }

  const lines: WindfallLine[] = [];
  let remaining = windfallCents;

  // 1) Cover overspent categories, worst deficit first.
  const overspent = context.categories
    .filter((category) => category.availableCents < 0)
    .sort((a, b) => a.availableCents - b.availableCents);
  for (const category of overspent) {
    if (remaining === 0) break;
    const cover = Math.min(-category.availableCents, remaining);
    lines.push({
      kind: "category",
      lineId: `windfall:category:${category.categoryId}`,
      categoryId: category.categoryId,
      name: category.name,
      suggestedCents: cover,
      reason: lineReasons.category,
    });
    remaining -= cover;
  }

  // 2) Fund sinking funds behind their target date, soonest deadline first.
  //    "Behind" is the danger zone's own verdict: overdue, or this month's
  //    plan short of the appetite-scaled required pace.
  const behind = context.funds
    .map((fund): { fund: WindfallFundInput; pace: FundPace } | null => {
      // The engine speaks the fund shape (id/targetCents/targetDate/balance);
      // map the advisor's input onto it.
      const pace = computeFundPace(
        {
          id: fund.fundId,
          targetCents: fund.targetCents,
          targetDate: fund.targetDate,
          balanceCents: fund.balanceCents,
        },
        context.asOf,
        fund.plannedThisMonthCents,
      );
      if (!pace) return null;
      const verdict = assessFundPace(
        pace,
        context.riskAppetite,
        DEFAULT_DANGER_THRESHOLDS,
      );
      return verdict === "funding-behind" ? { fund, pace } : null;
    })
    .filter((entry): entry is { fund: WindfallFundInput; pace: FundPace } =>
      entry !== null,
    )
    .filter((entry) => entry.fund.kind === "SINKING")
    .sort(
      (a, b) =>
        (a.fund.targetDate ?? "").localeCompare(b.fund.targetDate ?? "") ||
        b.pace.gapCents - a.pace.gapCents,
    );
  for (const { fund, pace } of behind) {
    if (remaining === 0) break;
    const topUp = Math.min(pace.gapCents, remaining);
    lines.push({
      kind: "fund",
      lineId: `windfall:fund:${fund.fundId}`,
      fundId: fund.fundId,
      name: fund.name,
      suggestedCents: topUp,
      reason: lineReasons.fund,
    });
    remaining -= topUp;
  }

  // 3) The active goal, weighted by risk appetite — an aggressive household
  //    leans in fully, a cautious one keeps most of the rest flexible.
  const goal = context.goal;
  if (goal && remaining > 0) {
    const share = Math.floor(
      (remaining * GOAL_WEIGHT_PERCENT[context.riskAppetite]) / 100,
    );
    // A goal with a target never asks past it; open-ended goals are uncapped.
    const towardGoal = Math.min(goal.targetCents ?? share, share);
    if (towardGoal > 0) {
      lines.push({
        kind: "goal",
        lineId: `windfall:goal:${goal.goalId}`,
        goalId: goal.goalId,
        name: goal.name,
        suggestedCents: towardGoal,
        suggestedCategoryId: goal.suggestedCategoryId,
        reason: lineReasons.goal,
      });
      remaining -= towardGoal;
    }
  }

  // 4) Whatever the waterfall left stays flexible in Ready to Assign.
  lines.push({
    kind: "remainder",
    lineId: "windfall:remainder",
    suggestedCents: remaining,
    reason: lineReasons.remainder,
  });

  return {
    monthId: context.monthId,
    windfallCents,
    riskAppetite: context.riskAppetite,
    lines,
  };
}

// ─── Trust boundary (the client sends a line back verbatim on Apply) ─────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseLineCommon(
  raw: Record<string, unknown>,
): { lineId: string; suggestedCents: number } | null {
  const { lineId, suggestedCents, reason } = raw;
  if (typeof lineId !== "string" || lineId.length === 0) return null;
  if (
    typeof suggestedCents !== "number" ||
    !Number.isInteger(suggestedCents) ||
    suggestedCents < 0
  ) {
    return null;
  }
  if (reason !== undefined && typeof reason !== "string") return null;
  return { lineId, suggestedCents };
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  return null; // wrong type — invalid
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Validate an untrusted windfall line at the action boundary. Returns null
 * for anything that isn't exactly a WindfallLine — the caller treats that as
 * a stale/invalid suggestion, never as data.
 */
export function parseWindfallLine(raw: unknown): WindfallLine | null {
  if (!isRecord(raw)) return null;
  const common = parseLineCommon(raw);
  if (!common) return null;
  const reason = optionalString(raw.reason);
  if (reason === null) return null;

  switch (raw.kind) {
    case "category": {
      const categoryId = requiredString(raw.categoryId);
      const name = requiredString(raw.name);
      if (!categoryId || !name) return null;
      return {
        kind: "category",
        lineId: common.lineId,
        categoryId,
        name,
        suggestedCents: common.suggestedCents,
        reason,
      };
    }
    case "fund": {
      const fundId = requiredString(raw.fundId);
      const name = requiredString(raw.name);
      if (!fundId || !name) return null;
      return {
        kind: "fund",
        lineId: common.lineId,
        fundId,
        name,
        suggestedCents: common.suggestedCents,
        reason,
      };
    }
    case "goal": {
      const goalId = requiredString(raw.goalId);
      const name = requiredString(raw.name);
      if (!goalId || !name) return null;
      const suggestedCategoryId = optionalString(raw.suggestedCategoryId);
      if (suggestedCategoryId === null) return null;
      return {
        kind: "goal",
        lineId: common.lineId,
        goalId,
        name,
        suggestedCents: common.suggestedCents,
        suggestedCategoryId,
        reason,
      };
    }
    case "remainder":
      return {
        kind: "remainder",
        lineId: common.lineId,
        suggestedCents: common.suggestedCents,
        reason,
      };
    default:
      return null;
  }
}
