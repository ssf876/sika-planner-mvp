/**
 * Pure completion-state rules for the planner's Ready-to-Assign hero.
 * The balanced "Every dollar assigned" state is an achievement — it must
 * never fire for a month that has no plan yet: a fresh month with no
 * income and no assignments would otherwise congratulate the household
 * for doing nothing. Rule:
 *   - income received > 0 AND RTA === 0  → balanced (the plan is done)
 *   - otherwise                          → planning (including the
 *     zero/zero empty month, which shows the "add income" invitation)
 */
export type CompletionState =
  | { kind: "empty"; message: string }
  | { kind: "balanced"; message: string }
  | { kind: "planning"; message: null };

export function getCompletionState(
  incomeReceivedCents: number,
  readyToAssignCents: number,
): CompletionState {
  if (incomeReceivedCents <= 0 && readyToAssignCents === 0) {
    return {
      kind: "empty",
      message: "Nothing to assign yet — Add this month's income to start your plan.",
    };
  }
  if (readyToAssignCents === 0) {
    return {
      kind: "balanced",
      message: "Every dollar assigned.",
    };
  }
  return { kind: "planning", message: null };
}
