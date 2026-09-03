/**
 * The planner's advisor seam (spec D6 + D12).
 *
 * The season advisor owns detecting and sourcing proposals; the planner owns
 * displaying them (visually distinct rows) and the apply path (each applied
 * line flows through engine.assign — nothing mutates before the user
 * confirms). This module is the contract between the two halves.
 */

/** One advisor suggestion, as the planner grid renders it. */
export interface PlannerProposal {
  id: string;
  categoryId: string;
  /** Integer cents (spec A1) the advisor suggests assigning; ≥ 0. */
  suggestedCents: number;
  /** Human-readable evidence line, e.g. "Back-to-school season". */
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate an untrusted proposal at the action boundary (the client sends a
 * proposal back verbatim on Apply). Returns null for anything that isn't
 * exactly the PlannerProposal shape with non-negative integer cents — the
 * caller treats that as a stale/invalid suggestion, never as data.
 */
export function parsePlannerProposal(raw: unknown): PlannerProposal | null {
  if (!isRecord(raw)) return null;

  const { id, categoryId, suggestedCents, reason } = raw;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof categoryId !== "string" || categoryId.length === 0) return null;
  if (
    typeof suggestedCents !== "number" ||
    !Number.isInteger(suggestedCents) ||
    suggestedCents < 0
  ) {
    return null;
  }
  if (reason !== undefined && typeof reason !== "string") return null;

  return {
    id,
    categoryId,
    suggestedCents,
    reason: reason === "" ? undefined : reason,
  };
}
