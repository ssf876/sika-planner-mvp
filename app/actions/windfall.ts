"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import { parseWindfallLine } from "@/lib/planner/windfall";
import { engineErrorMessage, RepositoryError } from "@/lib/repositories/errors";
import { contributeToFund } from "@/lib/repositories/funds";
import { assignWindfallToCategory } from "@/lib/repositories/planner";
import type { CategoryAvailable } from "@/src/engine";

export interface WindfallApplyResult {
  ok: boolean;
  error: string | null;
  readyToAssignCents?: number;
  /** Fresh engine-computed availability, present when the line assigned. */
  availability?: CategoryAvailable[];
  /** New fund balance, present when the line contributed to a fund. */
  fundBalanceCents?: number;
}

/**
 * Apply one ranked windfall line (D13). Runs only on the user's explicit
 * Apply — the banner's per-line button — and flows through the same engine
 * assign / fund-contribution paths as manual money moves: the category line
 * clears an overspend, the fund line tops up a behind fund, the goal line
 * assigns into the goal's mapped category. Nothing mutates before the click.
 *
 * The line arrives from the client untrusted and is re-validated here before
 * anything is written; ownership is enforced by the household-scoped
 * hydration (foreign ids fail with the engine's UNKNOWN_* or NOT_FOUND
 * errors).
 */
export async function applyWindfallLineAction(
  monthId: string,
  rawLine: unknown,
): Promise<WindfallApplyResult> {
  const user = await requireOnboardedUser();

  const line = parseWindfallLine(rawLine);
  if (!line) {
    return {
      ok: false,
      error: "That suggestion is no longer valid — refresh the planner.",
    };
  }

  try {
    if (line.kind === "remainder") {
      // The remainder is where unapplied money already sits — nothing to do.
      return {
        ok: false,
        error: "That money is already in Ready to Assign.",
      };
    }

    if (line.kind === "fund") {
      if (line.suggestedCents <= 0) {
        return {
          ok: false,
          error: "That suggestion is no longer valid — refresh the planner.",
        };
      }
      const { balanceCents } = await contributeToFund(
        prisma,
        user.householdId,
        { fundId: line.fundId, amountCents: line.suggestedCents },
      );
      revalidatePath("/planner");
      return { ok: true, error: null, fundBalanceCents: balanceCents };
    }

    // Category and goal lines both land as a delta on the category's
    // existing draft: a windfall line says "move this much more here", so
    // it must never replace money the month already assigned.
    const categoryId =
      line.kind === "goal" ? line.suggestedCategoryId : line.categoryId;
    if (!categoryId) {
      return {
        ok: false,
        error:
          "This goal has no category to assign into yet — add one on the funds board.",
      };
    }

    const result = await assignWindfallToCategory(prisma, user.householdId, {
      monthId,
      categoryId,
      deltaCents: line.suggestedCents,
    });
    revalidatePath("/planner");
    return { ok: true, error: null, ...result };
  } catch (error) {
    const message = engineErrorMessage(error);
    if (message) return { ok: false, error: message };
    if (error instanceof RepositoryError) {
      return { ok: false, error: error.message };
    }
    throw error; // unexpected failures surface, never swallow
  }
}
