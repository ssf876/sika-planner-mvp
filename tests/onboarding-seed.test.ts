import { describe, expect, it } from "vitest";

import {
  CATEGORY_GROUP_ORDER,
  DEFAULT_CATEGORIES,
  GOAL_LABELS,
  buildSeedPlan,
  readyToAssignCents,
  type OnboardingAnswers,
} from "@/lib/onboarding/seed";

const ANSWERS: OnboardingAnswers = {
  topGoal: "PAYOFF_DEBT",
  monthlyIncomeCents: 500000,
  householdSize: "JUST_ME",
};

describe("buildSeedPlan — seeding invariants (D10)", () => {
  it("scaffolds Ready to Assign equal to the entered income", () => {
    const plan = buildSeedPlan(ANSWERS, new Date("2026-09-03T12:00:00Z"));
    expect(readyToAssignCents(plan.month.expectedIncomeCents, [])).toBe(500000);
    // The applied plan assigns $0 everywhere — see allocation rows in applySeedPlan.
    const zeroAllocations = plan.categories.map(() => ({ assignedCents: 0 }));
    expect(
      readyToAssignCents(plan.month.expectedIncomeCents, zeroAllocations),
    ).toBe(500000);
  });

  it("creates exactly one goal, and it is the first active one", () => {
    const plan = buildSeedPlan(ANSWERS, new Date());
    expect(plan.goal.kind).toBe("PAYOFF_DEBT");
    expect(plan.goal.active).toBe(true);
    expect(GOAL_LABELS[plan.goal.kind as "PAYOFF_DEBT"]).toBe(
      "Pay off debt faster",
    );
  });

  it("seeds every mock-up category group with starter categories", () => {
    const plan = buildSeedPlan(ANSWERS, new Date());
    const groups = new Set(plan.categories.map((c) => c.group));
    expect([...groups].sort()).toEqual([...CATEGORY_GROUP_ORDER].sort());
    for (const group of CATEGORY_GROUP_ORDER) {
      expect(DEFAULT_CATEGORIES[group].length).toBeGreaterThan(0);
    }
  });

  it("scaffolds the month containing 'now' with the entered income", () => {
    const plan = buildSeedPlan(ANSWERS, new Date("2026-09-03T12:00:00Z"));
    expect(plan.month.year).toBe(2026);
    expect(plan.month.month).toBe(9);
    expect(plan.month.expectedIncomeCents).toBe(500000);
  });

  it("rolls the scaffolded month across the year boundary", () => {
    const december = buildSeedPlan(ANSWERS, new Date("2026-12-15T00:00:00Z"));
    expect(december.month.year).toBe(2026);
    expect(december.month.month).toBe(12);

    const january = buildSeedPlan(ANSWERS, new Date("2027-01-01T00:00:00Z"));
    expect(january.month.year).toBe(2027);
    expect(january.month.month).toBe(1);
  });

  it("names the household from the household-size answer", () => {
    const withPartner = buildSeedPlan(
      { ...ANSWERS, householdSize: "ME_AND_PARTNER" },
      new Date(),
    );
    expect(withPartner.household.name).toBe("Me + my partner");
  });

  it("carries the net-worth goal variant", () => {
    const netWorth = buildSeedPlan(
      { ...ANSWERS, topGoal: "GROW_NET_WORTH" },
      new Date(),
    );
    expect(netWorth.goal.kind).toBe("GROW_NET_WORTH");
    expect(netWorth.goal.name).toBe("Increase net worth");
  });
});

describe("readyToAssignCents", () => {
  it("subtracts assignments from expected income", () => {
    expect(
      readyToAssignCents(500000, [
        { assignedCents: 120000 },
        { assignedCents: 80000 },
      ]),
    ).toBe(300000);
  });

  it("can go negative when over-assigned (danger zone territory)", () => {
    expect(readyToAssignCents(100000, [{ assignedCents: 150000 }])).toBe(
      -50000,
    );
  });
});
