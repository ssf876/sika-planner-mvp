// Danger zone math (D3) — pure functions, no engine state, no side effects.
//
// Spec: "Danger zone is an engine view, not a UI afterthought: given a
// household's riskAppetite and each category's availableCents, it computes
// per-category and overall states — healthy, watch, overspent, and funding
// behind. Thresholds are tunable; the states are the contract."
//
// Every threshold is an integer percent and every comparison cross-multiplies
// integers, so classification is exact — no float money anywhere.

import type {
  DangerState,
  DangerZoneThresholdOverrides,
  DangerZoneThresholds,
  FundPace,
  RiskAppetite,
} from "./types";
import { EngineError } from "./errors";
import { calendarMonth } from "./invariants";

/**
 * Defaults per appetite. Watch: available ≤ 10% of assigned under BALANCED
 * (spec); CAUTIOUS tightens the buffer to 25% (warns earlier), AGGRESSIVE
 * loosens it to 5% (warns later). Pace: how far short of the required monthly
 * pace the month's plan may fall — CAUTIOUS demands full coverage, BALANCED
 * allows 10% slack, AGGRESSIVE 25%.
 */
export const DEFAULT_DANGER_THRESHOLDS: DangerZoneThresholds = {
  watchPercent: { CAUTIOUS: 25, BALANCED: 10, AGGRESSIVE: 5 },
  paceFloorPercent: { CAUTIOUS: 100, BALANCED: 90, AGGRESSIVE: 75 },
};

/** Worst-of rollup order: overspent > funding-behind > watch > healthy. */
const SEVERITY: Record<DangerState, number> = {
  healthy: 0,
  watch: 1,
  "funding-behind": 2,
  overspent: 3,
};

/** Worst of two states by severity — what makes an overall state from rows. */
export function worstDangerState(a: DangerState, b: DangerState): DangerState {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

const assertPercent = (
  value: number,
  knob: string,
  appetite: RiskAppetite,
): number => {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new EngineError(
      "INVALID_DANGER_THRESHOLD",
      `${knob}.${appetite} must be an integer percent 0–100, got ${value}`,
    );
  }
  return value;
};

/** Merges per-knob/per-appetite overrides over the defaults and validates ranges. */
export function resolveDangerThresholds(
  overrides?: DangerZoneThresholdOverrides,
): DangerZoneThresholds {
  const merged: DangerZoneThresholds = {
    watchPercent: { ...DEFAULT_DANGER_THRESHOLDS.watchPercent },
    paceFloorPercent: { ...DEFAULT_DANGER_THRESHOLDS.paceFloorPercent },
  };
  if (!overrides) return merged;
  for (const appetite of ["CAUTIOUS", "BALANCED", "AGGRESSIVE"] as const) {
    const watch = overrides.watchPercent?.[appetite];
    if (watch !== undefined) {
      merged.watchPercent[appetite] = assertPercent(
        watch,
        "watchPercent",
        appetite,
      );
    }
    const pace = overrides.paceFloorPercent?.[appetite];
    if (pace !== undefined) {
      merged.paceFloorPercent[appetite] = assertPercent(
        pace,
        "paceFloorPercent",
        appetite,
      );
    }
  }
  return merged;
}

/**
 * Watch line in cents: available ≤ this ⇒ watch. Null when nothing is
 * assigned — a category without a plan is not watchable.
 */
export function watchLineCents(
  assignedCents: number,
  appetite: RiskAppetite,
  thresholds: DangerZoneThresholds,
): number | null {
  if (assignedCents <= 0) return null;
  return Math.floor((assignedCents * thresholds.watchPercent[appetite]) / 100);
}

/**
 * Availability classification for one category: overspent (available < 0),
 * watch (assigned > 0 and available at or under the watch line), else
 * healthy. A category with nothing assigned is not watchable — unassigned
 * money is Ready to Assign's concern, not the danger zone's.
 */
export function classifyAvailability(
  availableCents: number,
  assignedCents: number,
  appetite: RiskAppetite,
  thresholds: DangerZoneThresholds,
): DangerState {
  if (availableCents < 0) return "overspent";
  const watchLine = watchLineCents(assignedCents, appetite, thresholds);
  if (watchLine != null && availableCents <= watchLine) return "watch";
  return "healthy";
}

/** Signed month distance from `from` to `to` (negative when `to` is earlier). */
const monthDistance = (
  from: { year: number; month: number },
  to: { year: number; month: number },
): number => (to.year - from.year) * 12 + (to.month - from.month);

/**
 * Pace facts for a fund with a target and a target date, as of the viewed
 * month. The deadline month still counts as runway (a contribution can land
 * in it), so monthsRemaining = monthDistance + 1 while the target month is
 * current or ahead, and 0 once it has passed. Required pace is an integer
 * ceil-division of the gap across the runway; null when the deadline has
 * passed with the target unmet (no plan can recover it — the fund is overdue).
 *
 * `plannedThisMonthCents` is the viewed month's funding plan: the allocation
 * to the fund's companion category. Null when the fund has no companion
 * category (engine state carries no contribution history, so a standalone
 * fund is assessed on deadline breach only).
 */
export function computeFundPace(
  fund: {
    id: string;
    targetCents?: number;
    targetDate?: string;
    balanceCents: number;
  },
  asOf: { year: number; month: number },
  plannedThisMonthCents: number | null = null,
): FundPace | null {
  const { targetCents, targetDate } = fund;
  if (targetCents == null || targetDate == null) return null;
  const distance = monthDistance(asOf, calendarMonth(targetDate));
  const overdue = distance < 0;
  const monthsRemaining = overdue ? 0 : distance + 1;
  const gapCents = Math.max(0, targetCents - fund.balanceCents);
  const requiredPerMonthCents =
    gapCents === 0
      ? 0
      : overdue
        ? null
        : Math.floor((gapCents + monthsRemaining - 1) / monthsRemaining);
  return {
    fundId: fund.id,
    gapCents,
    monthsRemaining,
    requiredPerMonthCents,
    plannedThisMonthCents,
    overdue,
  };
}

/**
 * Fund-level pace verdict. Behind when the deadline has passed with the
 * target unmet, or when the month's planned funding falls short of the
 * appetite-scaled required pace:
 * behind ⇔ planned × 100 < required × paceFloorPercent.
 */
export function assessFundPace(
  pace: FundPace,
  appetite: RiskAppetite,
  thresholds: DangerZoneThresholds,
): Extract<DangerState, "healthy" | "funding-behind"> {
  if (pace.gapCents === 0) return "healthy";
  if (pace.overdue) return "funding-behind";
  const planned = pace.plannedThisMonthCents;
  if (planned == null) return "healthy";
  // required is non-null here: overdue already returned above.
  const required = pace.requiredPerMonthCents ?? 0;
  return planned * 100 < required * thresholds.paceFloorPercent[appetite]
    ? "funding-behind"
    : "healthy";
}
