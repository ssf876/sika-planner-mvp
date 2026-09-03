import { describe, expect, it } from "vitest";

import {
  buildDashboardSections,
  isDebtCategory,
} from "@/lib/repositories/dashboard";
import type { CategoryAvailable } from "@/src/engine";

function available(
  categoryId: string,
  assignedCents: number,
  spentCents = 0,
): CategoryAvailable {
  return {
    categoryId,
    assignedCents,
    spentCents,
    cashflowReleasedCents: 0,
    availableCents: assignedCents - spentCents,
  };
}

describe("isDebtCategory", () => {
  it("keys the Savings & Funds / Debts split on the category's own name", () => {
    expect(isDebtCategory("Debt Payoff")).toBe(true);
    expect(isDebtCategory("Credit card debt")).toBe(true);
    expect(isDebtCategory("Savings & Funds")).toBe(false);
    expect(isDebtCategory("Emergency buffer")).toBe(false);
  });
});

describe("buildDashboardSections", () => {
  const categories = [
    { id: "cat-groceries", name: "Groceries", group: "NEEDS" as const },
    { id: "cat-dining", name: "Dining Out", group: "WANTS" as const },
    {
      id: "cat-savings",
      name: "Savings & Funds",
      group: "SAVINGS_DEBTS" as const,
    },
    { id: "cat-debt", name: "Debt Payoff", group: "SAVINGS_DEBTS" as const },
    { id: "cat-retirement", name: "Retirement", group: "INVESTMENTS" as const },
  ];

  it("renders five sections in the mock-up's order", () => {
    const sections = buildDashboardSections({
      categories,
      availability: [],
      stateByCategoryId: new Map(),
      funds: [],
      creditAccounts: [],
    });

    expect(sections.map((section) => section.id)).toEqual([
      "savings-funds",
      "needs",
      "wants",
      "debts",
      "investments",
    ]);
    expect(sections.map((section) => section.title)).toEqual([
      "Savings & Funds",
      "Needs",
      "Wants",
      "Debts",
      "Investments",
    ]);
  });

  it("splits SAVINGS_DEBTS into savings-side and debt-side sections", () => {
    const sections = buildDashboardSections({
      categories,
      availability: [available("cat-debt", 30000, 5000)],
      stateByCategoryId: new Map([["cat-debt", "watch" as const]]),
      funds: [
        {
          id: "fund-car",
          name: "Car repairs",
          kind: "SINKING" as const,
          balanceCents: 26000,
          targetCents: 100000,
        },
      ],
      creditAccounts: [
        { id: "acc-visa", name: "Visa card", owedCents: 81240 },
      ],
    });

    const savings = sections.find((s) => s.id === "savings-funds");
    expect(savings?.categories.map((row) => row.name)).toEqual([
      "Savings & Funds",
    ]);
    expect(savings?.funds).toHaveLength(1);

    const debts = sections.find((s) => s.id === "debts");
    expect(debts?.categories.map((row) => row.name)).toEqual(["Debt Payoff"]);
    expect(debts?.categories[0]?.state).toBe("watch");
    expect(debts?.debts).toEqual([
      { id: "acc-visa", name: "Visa card", owedCents: 81240 },
    ]);
  });

  it("pairs availability rows with categories and defaults missing ones to healthy zeros", () => {
    const sections = buildDashboardSections({
      categories,
      availability: [
        available("cat-groceries", 40000, 4000),
        available("cat-dining", 0),
      ],
      stateByCategoryId: new Map(),
      funds: [],
      creditAccounts: [],
    });

    const needs = sections.find((s) => s.id === "needs");
    expect(needs?.categories).toEqual([
      {
        categoryId: "cat-groceries",
        name: "Groceries",
        assignedCents: 40000,
        spentCents: 4000,
        availableCents: 36000,
        state: "healthy",
      },
    ]);
    const wants = sections.find((s) => s.id === "wants");
    expect(wants?.categories).toEqual([
      {
        categoryId: "cat-dining",
        name: "Dining Out",
        assignedCents: 0,
        spentCents: 0,
        availableCents: 0,
        state: "healthy",
      },
    ]);
    expect(
      sections.find((s) => s.id === "investments")?.categories[0],
    ).toMatchObject({
      categoryId: "cat-retirement",
      assignedCents: 0,
      state: "healthy",
    });
  });
});
