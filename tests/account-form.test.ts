import { describe, expect, it } from "vitest";

import {
  ACCOUNT_KIND_LABELS,
  ONBOARDING_ACCOUNT_KINDS,
  parseAccountSetupForm,
  type AccountSetupFields,
} from "@/lib/accounts/form";

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

function parseFields(fields: Record<string, string>): AccountSetupFields {
  const parsed = parseAccountSetupForm(form(fields));
  if (!parsed.ok) throw new Error(`expected success, got: ${parsed.error}`);
  return parsed.fields;
}

function parseError(fields: Record<string, string>): string {
  const parsed = parseAccountSetupForm(form(fields));
  if (parsed.ok) throw new Error("expected a validation error");
  return parsed.error;
}

describe("parseAccountSetupForm", () => {
  it("parses a complete account with a starting balance into cents", () => {
    expect(
      parseFields({
        kind: "CHECKING",
        name: "Everyday Checking",
        startingBalance: "1,200.50",
      }),
    ).toEqual({
      kind: "CHECKING",
      name: "Everyday Checking",
      startingCents: 120_050,
    });
  });

  it("treats a missing starting balance as zero — it is optional", () => {
    expect(parseFields({ kind: "CREDIT", name: "Visa Card" })).toEqual({
      kind: "CREDIT",
      name: "Visa Card",
      startingCents: 0,
    });
  });

  it("accepts a bare dollar amount and trims the name", () => {
    expect(
      parseFields({
        kind: "CASH",
        name: "  Cash Wallet  ",
        startingBalance: "$40",
      }),
    ).toEqual({ kind: "CASH", name: "Cash Wallet", startingCents: 4_000 });
  });

  it("rejects a missing or unknown account type", () => {
    expect(parseError({ name: "Everyday Checking" })).toBe(
      "Choose an account type.",
    );
    expect(parseError({ kind: "ROCKET_FUEL", name: "Everyday Checking" })).toBe(
      "Choose an account type.",
    );
  });

  it("rejects a missing or blank name", () => {
    expect(parseError({ kind: "CHECKING" })).toBe("Name the account.");
    expect(parseError({ kind: "CHECKING", name: "   " })).toBe(
      "Name the account.",
    );
  });

  it("rejects a malformed starting balance", () => {
    for (const bad of ["abc", "-5", "12.345"]) {
      expect(
        parseError({
          kind: "SAVINGS",
          name: "Rainy Day",
          startingBalance: bad,
        }),
      ).toBe("Enter a starting balance as a dollar amount, e.g. 1,250.");
    }
  });

  it("reads comma groups as thousands separators, per the shared money parser", () => {
    expect(
      parseFields({
        kind: "SAVINGS",
        name: "Rainy Day",
        startingBalance: "1,20.00",
      }),
    ).toEqual({ kind: "SAVINGS", name: "Rainy Day", startingCents: 12_000 });
  });

  it("offers exactly the four first-run kinds with their labels", () => {
    expect(ONBOARDING_ACCOUNT_KINDS).toEqual([
      "CHECKING",
      "SAVINGS",
      "CREDIT",
      "CASH",
    ]);
    expect(ACCOUNT_KIND_LABELS.CHECKING).toBe("Checking");
    expect(ACCOUNT_KIND_LABELS.SAVINGS).toBe("Savings");
    expect(ACCOUNT_KIND_LABELS.CREDIT).toBe("Credit card");
    expect(ACCOUNT_KIND_LABELS.CASH).toBe("Cash wallet");
  });
});
