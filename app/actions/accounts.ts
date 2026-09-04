"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import { parseIncomeToCents } from "@/lib/auth/validate";
import { accountKindFrom, parseAccountSetupForm } from "@/lib/accounts/form";
import {
  createAccount,
  deleteAccount,
  updateAccount,
} from "@/lib/repositories/accounts";
import { RepositoryError } from "@/lib/repositories/errors";

export interface AccountFormState {
  error: string | null;
  /** True once a submission succeeds — the client's reset/confirmation signal. */
  ok: boolean;
}

/** Shared CRUD plumbing: session → household, error → form state. */
async function withHousehold(
  run: (householdId: string) => Promise<void>,
): Promise<AccountFormState> {
  const user = await requireOnboardedUser();
  try {
    await run(user.householdId);
  } catch (error) {
    if (error instanceof RepositoryError) {
      return { error: error.message, ok: false };
    }
    throw error; // unexpected failures surface, never swallow
  }
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
  return { error: null, ok: true };
}

export async function createAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const parsed = parseAccountSetupForm(formData);
  if (!parsed.ok) return { error: parsed.error, ok: false };

  return withHousehold(async (householdId) => {
    await createAccount(prisma, householdId, parsed.fields);
  });
}

export async function updateAccountAction(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const accountId = String(formData.get("accountId") ?? "");
  if (!accountId) return { error: "Missing account.", ok: false };

  const kind = accountKindFrom(String(formData.get("kind") ?? ""));
  if (!kind) return { error: "Choose an account type.", ok: false };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name the account.", ok: false };

  const startingRaw = String(formData.get("startingBalance") ?? "").trim();
  const startingCents = parseIncomeToCents(startingRaw);
  if (startingCents === null) {
    return {
      error: "Enter a starting balance as a dollar amount, e.g. 1,250.",
      ok: false,
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
  if (!accountId) return { error: "Missing account.", ok: false };

  return withHousehold((householdId) =>
    deleteAccount(prisma, householdId, accountId),
  );
}
