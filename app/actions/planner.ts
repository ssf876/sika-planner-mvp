"use server";

import { revalidatePath } from "next/cache";

import { requireOnboardedUser } from "@/lib/auth/session";
import { parseIncomeToCents } from "@/lib/auth/validate";
import { engineErrorMessage } from "@/lib/repositories/errors";
import {
  assignToCategory,
  copyPreviousMonthPlan,
} from "@/lib/repositories/planner";
import { prisma } from "@/lib/db";
import type { CategoryAvailable } from "@/src/engine";

export interface PlannerActionResult {
  ok: boolean;
  error: string | null;
  readyToAssignCents?: number;
  /** Fresh engine-computed availability, present on success. */
  availability?: CategoryAvailable[];
}

function failure(error: string): PlannerActionResult {
  return { ok: false, error };
}

function domainError(error: unknown): PlannerActionResult | null {
  const message = engineErrorMessage(error);
  return message ? failure(message) : null;
}

/**
 * Per-category assignment (D6). `amount` is a dollar string from the grid
 * ("150", "24.50"); 0 unassigns. The engine is the only writer — RTA and
 * availability in the response are recomputed from the persisted state.
 */
export async function assignCategoryAction(
  monthId: string,
  categoryId: string,
  amount: string,
): Promise<PlannerActionResult> {
  const user = await requireOnboardedUser();

  const cents = parseIncomeToCents(amount ?? "");
  if (cents === null) {
    return failure("Enter a valid dollar amount.");
  }

  try {
    const result = await assignToCategory(prisma, user.householdId, {
      monthId,
      categoryId,
      cents,
    });
    revalidatePath("/planner");
    return { ok: true, error: null, ...result };
  } catch (error) {
    const handled = domainError(error);
    if (handled) return handled;
    throw error;
  }
}

/**
 * "Start from last month, then edit" (D6): copies every non-zero previous-
 * month allocation into this month. A friendly failure when the household
 * has no previous month yet.
 */
export async function copyPreviousMonthAction(
  monthId: string,
): Promise<PlannerActionResult> {
  const user = await requireOnboardedUser();

  try {
    const result = await copyPreviousMonthPlan(
      prisma,
      user.householdId,
      monthId,
    );
    revalidatePath("/planner");
    return { ok: true, error: null, ...result };
  } catch (error) {
    const handled = domainError(error);
    if (handled) return handled;
    throw error;
  }
}
