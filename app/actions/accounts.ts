"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import { parseIncomeToCents } from "@/lib/auth/validate";
import {
  createAccount,
  deleteAccount,
  updateAccount,
} from "@/lib/repositories/accounts";
import { RepositoryError } from "@/lib/repositories/errors";

export interface AccountFormState {
  error: string | null;
}

export const ACCOUNT_KINDS = [
  "CHECKING",
  "SAVINGS",
  "CREDIT",
  "CASH",
  "INVESTMENT",
] as const;

export type AccountFormKind = (typeof ACCOUNT_KINDS)[number];

export const ACCOUNT_KIND_LABELS: Record<AccountFormKind, string> = {
  CHECKING: "Checking",
  SAVINGS: "Savings",
  CREDIT: "Credit card",
  CASH: "Cash wallet",
  INVESTMENT: "Investment",
};

function accountKindFrom(raw: string): AccountFormKind | null {
  return ACCOUNT_KINDS.find((kind) => kind === raw) ?? null;
}

/** Shared CRUD plumbing: session → household, error → form state. */
async function withHousehold(
  run: (householdId: string) => Promise<void>,
): Promise<AccountFormState> {
  const user = await requireOnboardedUser();
  try {
    await run(user.householdId);
  } catch (error) {
    if (error instanceof RepositoryError) return { error: error.message };
    throw error; // unexpected failures surface, never swallow
  }
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  return { error: null };
}

export async function createAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const kind = accountKindFrom(String(formData.get("kind") ?? ""));
  if (!kind) return { error: "Choose an account type." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name the account." };

  const startingRaw = String(formData.get("startingBalance") ?? "").trim();
  const startingCents = startingRaw ? parseIncomeToCents(startingRaw) : 0;
  if (startingCents === null) {
    return {
      error: "Enter a starting balance as a dollar amount, e.g. 1,250.",
    };
  }

  return withHousehold(async (householdId) => {
    await createAccount(prisma, householdId, { kind, name, startingCents });
  });
}

export async function updateAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return { error: "Missing account." };

  const kind = accountKindFrom(String(formData.get("kind") ?? ""));
  if (!kind) return { error: "Choose an account type." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name the account." };

  const startingRaw = String(formData.get("startingBalance") ?? "").trim();
  const startingCents = parseIncomeToCents(startingRaw);
  if (startingCents === null) {
    return {
      error: "Enter a starting balance as a dollar amount, e.g. 1,250.",
    };
  }

  return withHousehold((householdId) =>
    updateAccount(prisma, householdId, accountId, {
      kind,
      name,
      startingCents,
    }),
  );
}

export async function deleteAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return { error: "Missing account." };

  return withHousehold((householdId) =>
    deleteAccount(prisma, householdId, accountId),
  );
}
