/**
 * Danger-state vocabulary shared by every budget-facing primitive
 * (spec D3/D6/D7) — exactly three visual states:
 *
 * - `healthy`   — on or comfortably under plan
 * - `watch`     — approaching the limit (>= {@link WATCH_THRESHOLD} spent)
 * - `overspent` — beyond the limit
 */
export type DangerTone = "healthy" | "watch" | "overspent";

/** Every danger tone, in escalation order. Useful for iterating the
 *  vocabulary in stories, sheets, and tests. */
export const dangerTones: readonly DangerTone[] = [
  "healthy",
  "watch",
  "overspent",
];
