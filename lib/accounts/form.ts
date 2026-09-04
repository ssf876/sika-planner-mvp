/**
 * Pure form-level parsing for account setup — no I/O, fully unit-testable.
 * The server action applies the parsed fields; the onboarding setup step
 * renders its kind options from this module so both sides name the same set.
 */

import { parseIncomeToCents } from "@/lib/auth/validate";

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

/** The kinds first-run setup offers; Investment waits for full account management. */
export const ONBOARDING_ACCOUNT_KINDS = [
  "CHECKING",
  "SAVINGS",
  "CREDIT",
  "CASH",
] as const satisfies readonly AccountFormKind[];

export type OnboardingAccountKind = (typeof ONBOARDING_ACCOUNT_KINDS)[number];

export function accountKindFrom(raw: string): AccountFormKind | null {
  return ACCOUNT_KINDS.find((kind) => kind === raw) ?? null;
}

export interface AccountSetupFields {
  kind: AccountFormKind;
  name: string;
  startingCents: number;
}

export type AccountSetupParse =
  { ok: false; error: string } | { ok: true; fields: AccountSetupFields };

/** Parse the setup form's kind/name/startingBalance trio, or name the problem. */
export function parseAccountSetupForm(formData: FormData): AccountSetupParse {
  const kind = accountKindFrom(String(formData.get("kind") ?? ""));
  if (!kind) return { ok: false, error: "Choose an account type." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Name the account." };

  const startingRaw = String(formData.get("startingBalance") ?? "").trim();
  const startingCents = startingRaw ? parseIncomeToCents(startingRaw) : 0;
  if (startingCents === null) {
    return {
      ok: false,
      error: "Enter a starting balance as a dollar amount, e.g. 1,250.",
    };
  }

  return { ok: true, fields: { kind, name, startingCents } };
}
