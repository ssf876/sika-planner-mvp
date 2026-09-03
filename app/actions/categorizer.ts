"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import {
  confirmReviewedTransaction,
  setAutoAcceptSuggestions,
} from "@/lib/repositories/categorizer";
import {
  engineErrorMessage,
  RepositoryError,
} from "@/lib/repositories/errors";

import type { ReviewQueueFormState } from "./categorizer-state";

/**
 * One-click confirm (or edit-then-confirm) of a review-queue row. The
 * pre-filled select is the categorizer's suggestion; submitting it as-is
 * confirms, changing it first edits — both teach the learner.
 */
export async function confirmReviewAction(
  _prev: ReviewQueueFormState,
  formData: FormData,
): Promise<ReviewQueueFormState> {
  const user = await requireOnboardedUser();

  const transactionId = String(formData.get("transactionId") ?? "");
  if (!transactionId) {
    return { error: "Missing transaction.", ok: false };
  }
  // Absent for income rows (income has no category).
  const categoryIdRaw = String(formData.get("categoryId") ?? "").trim();
  const categoryId = categoryIdRaw || undefined;

  try {
    await confirmReviewedTransaction(prisma, user.householdId, {
      transactionId,
      categoryId,
    });
  } catch (error) {
    const message = engineErrorMessage(error);
    if (message) return { error: message, ok: false };
    if (error instanceof RepositoryError) {
      return { error: error.message, ok: false };
    }
    throw error; // unexpected failures surface, never swallow
  }

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/planner");
  return { error: null, ok: true };
}

/** Toggle the household's high-confidence auto-accept setting (D5). */
export async function setAutoAcceptAction(formData: FormData): Promise<void> {
  const user = await requireOnboardedUser();
  const enabled = formData.get("autoAccept") === "on";
  await setAutoAcceptSuggestions(prisma, user.householdId, enabled);
  revalidatePath("/transactions");
}
