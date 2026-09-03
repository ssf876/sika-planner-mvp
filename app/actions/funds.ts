"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import { parseIncomeToCents } from "@/lib/auth/validate";
import {
  contributeToFund,
  createFund,
  recordPopupDraw,
  recordStaticDraw,
} from "@/lib/repositories/funds";
import {
  createGoal,
  setGoalActive,
  updateGoal,
} from "@/lib/repositories/goals";
import {
  engineErrorMessage,
  RepositoryError,
} from "@/lib/repositories/errors";

export interface FundFormState {
  error: string | null;
  ok: boolean;
}

export interface GoalFormState {
  error: string | null;
  ok: boolean;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Shared plumbing: session → household, domain error → form state. */
async function withHousehold(
  run: (householdId: string) => Promise<unknown>,
  revalidate: (path: string) => void,
): Promise<{ error: string | null; ok: boolean }> {
  const user = await requireOnboardedUser();
  try {
    await run(user.householdId);
  } catch (error) {
    const message = engineErrorMessage(error);
    if (message) return { error: message, ok: false };
    if (error instanceof RepositoryError) {
      return { error: error.message, ok: false };
    }
    throw error; // unexpected failures surface, never swallow
  }
  revalidate("/funds");
  revalidate("/dashboard");
  return { error: null, ok: true };
}

function amountFrom(formData: FormData, field = "amount"): number | null {
  return parseIncomeToCents(String(formData.get(field) ?? ""));
}

// ─── Fund actions ────────────────────────────────────────────────────────────

const FUND_KINDS = ["SINKING", "STATIC"] as const;
type FundFormKind = (typeof FUND_KINDS)[number];

function fundKindFrom(raw: string): FundFormKind | null {
  return FUND_KINDS.find((kind) => kind === raw) ?? null;
}

/** Create a sinking or static fund, optionally backed by an existing category. */
export async function createFundAction(
  _prev: FundFormState,
  formData: FormData,
): Promise<FundFormState> {
  const kind = fundKindFrom(String(formData.get("kind") ?? ""));
  if (!kind) return { error: "Choose sinking or static.", ok: false };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name the fund.", ok: false };

  const targetRaw = String(formData.get("targetAmount") ?? "").trim();
  const targetCents = targetRaw ? amountFrom(formData, "targetAmount") : 0;
  if (targetCents === null) {
    return { error: "Enter the target as a dollar amount, e.g. 1,200.", ok: false };
  }

  const targetDate = String(formData.get("targetDate") ?? "");
  if (targetDate && !CALENDAR_DATE.test(targetDate)) {
    return { error: "Enter the target date as YYYY-MM-DD.", ok: false };
  }

  // Empty select = let a sinking fund auto-create its companion category.
  const companionCategoryId = String(formData.get("companionCategoryId") ?? "");

  return withHousehold(
    (householdId) =>
      createFund(prisma, householdId, {
        kind,
        name,
        targetCents: targetCents || undefined,
        targetDate: targetDate || undefined,
        companionCategoryId: companionCategoryId || undefined,
      }),
    revalidatePath,
  );
}

/** Add money to a fund's balance. */
export async function contributeFundAction(
  _prev: FundFormState,
  formData: FormData,
): Promise<FundFormState> {
  const fundId = String(formData.get("fundId") ?? "");
  if (!fundId) return { error: "Missing fund.", ok: false };

  const amountCents = amountFrom(formData);
  if (amountCents === null || amountCents === 0) {
    return { error: "Enter an amount greater than zero.", ok: false };
  }

  return withHousehold(
    (householdId) =>
      contributeToFund(prisma, householdId, { fundId, amountCents }),
    revalidatePath,
  );
}

/**
 * Sinking-fund pop-up: the fund pays an unexpected expense — fund −, expense
 * posts against its companion category, the month's cashflow releases +.
 */
export async function recordFundDrawAction(
  _prev: FundFormState,
  formData: FormData,
): Promise<FundFormState> {
  const fundId = String(formData.get("fundId") ?? "");
  if (!fundId) return { error: "Missing fund.", ok: false };

  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return { error: "Choose the account that paid.", ok: false };

  const amountCents = amountFrom(formData);
  if (amountCents === null || amountCents === 0) {
    return { error: "Enter an amount greater than zero.", ok: false };
  }

  const payee = String(formData.get("payee") ?? "").trim();
  if (!payee) return { error: "Enter who was paid.", ok: false };

  const date = String(formData.get("date") ?? "");
  if (!CALENDAR_DATE.test(date)) {
    return { error: "Enter the date as YYYY-MM-DD.", ok: false };
  }

  const note = String(formData.get("note") ?? "").trim();

  return withHousehold(
    (householdId) =>
      recordPopupDraw(prisma, householdId, {
        fundId,
        accountId,
        amountCents,
        date,
        payee,
        note: note || undefined,
      }),
    revalidatePath,
  );
}

/**
 * Explicit static-goal draw: the goal only moves when drawn from, and the
 * draw reports as "popped up" — no income, no category.
 */
export async function recordStaticDrawAction(
  _prev: FundFormState,
  formData: FormData,
): Promise<FundFormState> {
  const fundId = String(formData.get("fundId") ?? "");
  if (!fundId) return { error: "Missing fund.", ok: false };

  const amountCents = amountFrom(formData);
  if (amountCents === null || amountCents === 0) {
    return { error: "Enter an amount greater than zero.", ok: false };
  }

  const date = String(formData.get("date") ?? "");
  if (!CALENDAR_DATE.test(date)) {
    return { error: "Enter the date as YYYY-MM-DD.", ok: false };
  }

  return withHousehold(
    (householdId) =>
      recordStaticDraw(prisma, householdId, { fundId, amountCents, date }),
    revalidatePath,
  );
}

// ─── Goal actions ────────────────────────────────────────────────────────────

const GOAL_KINDS = ["PAYOFF_DEBT", "GROW_NET_WORTH", "CUSTOM"] as const;
type GoalFormKind = (typeof GOAL_KINDS)[number];

function goalKindFrom(raw: string): GoalFormKind | null {
  return GOAL_KINDS.find((kind) => kind === raw) ?? null;
}

/** Create a goal — active by default, so windfall ranking considers it. */
export async function createGoalAction(
  _prev: GoalFormState,
  formData: FormData,
): Promise<GoalFormState> {
  const kind = goalKindFrom(String(formData.get("kind") ?? ""));
  if (!kind) return { error: "Choose a goal type.", ok: false };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name the goal.", ok: false };

  const targetRaw = String(formData.get("targetAmount") ?? "").trim();
  const targetCents = targetRaw ? amountFrom(formData, "targetAmount") : 0;
  if (targetCents === null) {
    return { error: "Enter the target as a dollar amount, e.g. 5,000.", ok: false };
  }

  return withHousehold(
    (householdId) =>
      createGoal(prisma, householdId, {
        kind,
        name,
        targetCents: targetCents || undefined,
      }),
    revalidatePath,
  );
}

/** Edit a goal's name, type, or target. */
export async function updateGoalAction(
  _prev: GoalFormState,
  formData: FormData,
): Promise<GoalFormState> {
  const goalId = String(formData.get("goalId") ?? "");
  if (!goalId) return { error: "Missing goal.", ok: false };

  const kind = goalKindFrom(String(formData.get("kind") ?? ""));
  if (!kind) return { error: "Choose a goal type.", ok: false };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name the goal.", ok: false };

  const targetRaw = String(formData.get("targetAmount") ?? "").trim();
  const targetCents = targetRaw ? amountFrom(formData, "targetAmount") : 0;
  if (targetCents === null) {
    return { error: "Enter the target as a dollar amount, e.g. 5,000.", ok: false };
  }

  return withHousehold(
    (householdId) =>
      updateGoal(prisma, householdId, goalId, {
        kind,
        name,
        targetCents: targetCents || undefined,
      }),
    revalidatePath,
  );
}

/** Flip a goal's active flag (retire without deleting). */
export async function toggleGoalAction(
  _prev: GoalFormState,
  formData: FormData,
): Promise<GoalFormState> {
  const goalId = String(formData.get("goalId") ?? "");
  if (!goalId) return { error: "Missing goal.", ok: false };

  const active = formData.get("active") === "true";

  return withHousehold(
    (householdId) => setGoalActive(prisma, householdId, goalId, active),
    revalidatePath,
  );
}
