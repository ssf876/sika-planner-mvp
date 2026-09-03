"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import { parseIncomeToCents } from "@/lib/auth/validate";
import {
  recordHouseholdTransfer,
  recordManualTransaction,
  type ManualTxKind,
} from "@/lib/repositories/transactions";
import {
  engineErrorMessage,
  RepositoryError,
} from "@/lib/repositories/errors";

export interface TransactionFormState {
  error: string | null;
  ok: boolean;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Manual entry (D4). The user picked the category as they typed, so entries
 * land CONFIRMED — unless they explicitly flag it for the review queue
 * (NEEDS_REVIEW), which keeps auto-categorization honest.
 */
export async function recordTransactionAction(
  _prev: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const user = await requireOnboardedUser();

  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return { error: "Choose an account.", ok: false };

  const kindRaw = String(formData.get("kind") ?? "");
  const kind: ManualTxKind | null =
    kindRaw === "INCOME" || kindRaw === "EXPENSE" ? kindRaw : null;
  if (!kind) return { error: "Choose income or expense.", ok: false };

  const amountCents = parseIncomeToCents(String(formData.get("amount") ?? ""));
  if (amountCents === null || amountCents === 0) {
    return { error: "Enter an amount greater than zero.", ok: false };
  }
  // The form collects a magnitude; the kind decides the direction of money.
  const signedCents = kind === "EXPENSE" ? -amountCents : amountCents;

  const payee = String(formData.get("payee") ?? "").trim();
  if (!payee) return { error: "Enter a payee.", ok: false };

  const date = String(formData.get("date") ?? "");
  if (!CALENDAR_DATE.test(date)) {
    return { error: "Enter the date as YYYY-MM-DD.", ok: false };
  }

  const categoryId = String(formData.get("categoryId") ?? "");
  if (kind === "EXPENSE" && !categoryId) {
    return { error: "Pick a category — every expense needs one.", ok: false };
  }

  const note = String(formData.get("note") ?? "").trim();
  const pending = formData.get("pending") === "on";
  const needsReview = formData.get("needsReview") === "on";

  try {
    await recordManualTransaction(prisma, user.householdId, {
      accountId,
      kind,
      amountCents: signedCents,
      date,
      payee,
      categoryId: kind === "EXPENSE" ? categoryId : undefined,
      note: note || undefined,
      pending,
      reviewState: needsReview ? "NEEDS_REVIEW" : "CONFIRMED",
    });
  } catch (error) {
    const message = engineErrorMessage(error);
    if (message) return { error: message, ok: false };
    if (error instanceof RepositoryError) {
      return { error: error.message, ok: false };
    }
    throw error; // unexpected failures surface, never swallow
  }

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  return { error: null, ok: true };
}

/** Move money between two of the household's accounts (a transfer, not spend). */
export async function recordTransferAction(
  _prev: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const user = await requireOnboardedUser();

  const fromAccountId = String(formData.get("fromAccountId") ?? "");
  const toAccountId = String(formData.get("toAccountId") ?? "");
  if (!fromAccountId || !toAccountId) {
    return { error: "Choose both accounts.", ok: false };
  }
  if (fromAccountId === toAccountId) {
    return { error: "Pick two different accounts.", ok: false };
  }

  const amountCents = parseIncomeToCents(String(formData.get("amount") ?? ""));
  if (amountCents === null || amountCents === 0) {
    return { error: "Enter an amount greater than zero.", ok: false };
  }

  const payee = String(formData.get("payee") ?? "").trim() || "Transfer";
  const date = String(formData.get("date") ?? "");
  if (!CALENDAR_DATE.test(date)) {
    return { error: "Enter the date as YYYY-MM-DD.", ok: false };
  }

  try {
    await recordHouseholdTransfer(prisma, user.householdId, {
      fromAccountId,
      toAccountId,
      amountCents,
      date,
      payee,
    });
  } catch (error) {
    const message = engineErrorMessage(error);
    if (message) return { error: message, ok: false };
    if (error instanceof RepositoryError) {
      return { error: error.message, ok: false };
    }
    throw error;
  }

  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  return { error: null, ok: true };
}
