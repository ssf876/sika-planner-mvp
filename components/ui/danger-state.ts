import type { DangerTone } from "./types";

/**
 * Spent ratio at or above which a category is "watching" its limit.
 * Tunable by design; the danger-zone engine (spec D3) owns the
 * authoritative per-household computation from risk appetite — this
 * constant is the default visual fallback for primitives.
 */
export const WATCH_THRESHOLD = 0.75;

/**
 * Map a spend to the danger vocabulary. Fully spent (but not over)
 * reads as `watch`; `overspent` is reserved for exceeding the total.
 *
 * Money is integer cents everywhere (repo rule) — non-integer or
 * negative input is a programmer error and throws.
 */
export function classifySpendState(
  spentCents: number,
  totalCents: number,
): DangerTone {
  if (!Number.isInteger(spentCents) || !Number.isInteger(totalCents)) {
    throw new TypeError(
      `Money must be integer cents, received: ${spentCents}, ${totalCents}`,
    );
  }
  if (spentCents < 0 || totalCents < 0) {
    throw new RangeError(
      `Spent and total must be non-negative, received: ${spentCents}, ${totalCents}`,
    );
  }
  if (spentCents > totalCents) return "overspent";
  if (totalCents === 0) return "healthy";
  return spentCents / totalCents >= WATCH_THRESHOLD ? "watch" : "healthy";
}
