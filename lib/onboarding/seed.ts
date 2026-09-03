import type {
  Prisma,
  CategoryGroup,
  GoalKind,
  RiskAppetite,
} from "@prisma/client";

/**
 * D10 onboarding seeding (spec art_psxjH3kE): the three onboarding answers —
 * top money goal, monthly income, household size — seed the household, the
 * first active Goal, the mock-up category groups, and a scaffolded month whose
 * Ready to Assign equals the entered income ($0 assigned).
 *
 * buildSeedPlan is pure (the caller supplies "now") so the seeding invariants
 * are unit-testable; applySeedPlan is the only place that touches Prisma.
 */

export type HouseholdSize = "JUST_ME" | "ME_AND_PARTNER" | "ME_AND_FAMILY";

export const HOUSEHOLD_SIZE_LABELS: Record<HouseholdSize, string> = {
  JUST_ME: "Just me",
  ME_AND_PARTNER: "Me + my partner",
  ME_AND_FAMILY: "Me + other family members",
};

export function isHouseholdSize(value: string): value is HouseholdSize {
  return value in HOUSEHOLD_SIZE_LABELS;
}

export interface OnboardingAnswers {
  topGoal: Extract<GoalKind, "PAYOFF_DEBT" | "GROW_NET_WORTH">;
  monthlyIncomeCents: number;
  householdSize: HouseholdSize;
}

export interface SeedPlan {
  household: {
    name: string;
    riskAppetite: RiskAppetite;
    monthlyIncomeCents: number;
  };
  goal: { kind: GoalKind; name: string; active: true };
  categories: { group: CategoryGroup; name: string }[];
  month: { year: number; month: number; expectedIncomeCents: number };
}

export const GOAL_LABELS: Record<OnboardingAnswers["topGoal"], string> = {
  PAYOFF_DEBT: "Pay off debt faster",
  GROW_NET_WORTH: "Increase net worth",
};

// Starter categories per mock-up section (CategoryGroup collapses the
// mock-up's "Savings & Funds" and "Debts" sections into SAVINGS_DEBTS).
export const DEFAULT_CATEGORIES: Record<CategoryGroup, string[]> = {
  NEEDS: [
    "Groceries",
    "Rent / Mortgage",
    "Utilities",
    "Transportation",
    "Insurance",
  ],
  WANTS: ["Dining Out", "Entertainment", "Shopping", "Subscriptions"],
  SAVINGS_DEBTS: ["Savings & Funds", "Debt Payoff"],
  INVESTMENTS: ["Retirement", "Brokerage"],
};

export const CATEGORY_GROUP_ORDER: CategoryGroup[] = [
  "NEEDS",
  "WANTS",
  "SAVINGS_DEBTS",
  "INVESTMENTS",
];

/** Pure: plan every row onboarding will seed, including the scaffolded month. */
export function buildSeedPlan(answers: OnboardingAnswers, now: Date): SeedPlan {
  const { topGoal, monthlyIncomeCents, householdSize } = answers;

  return {
    household: {
      name: HOUSEHOLD_SIZE_LABELS[householdSize],
      riskAppetite: "BALANCED",
      monthlyIncomeCents,
    },
    goal: { kind: topGoal, name: GOAL_LABELS[topGoal], active: true },
    categories: CATEGORY_GROUP_ORDER.flatMap((group) =>
      DEFAULT_CATEGORIES[group].map((name) => ({ group, name })),
    ),
    month: {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      expectedIncomeCents: monthlyIncomeCents,
    },
  };
}

/**
 * Ready to Assign = what the household expects to receive this month minus
 * what is already assigned. The full engine owns this computation once
 * transactions and fund draws exist; onboarding only ever deals in
 * $0-assigned months, so the simple sum is exact here.
 */
export function readyToAssignCents(
  expectedIncomeCents: number,
  allocations: { assignedCents: number }[],
): number {
  const assigned = allocations.reduce((sum, a) => sum + a.assignedCents, 0);
  return expectedIncomeCents - assigned;
}

/**
 * Apply a seed plan inside a transaction: household, user link, categories,
 * the scaffolded month with $0 allocations for every category, and the first
 * active goal. Returns the household id.
 */
export async function applySeedPlan(
  tx: Prisma.TransactionClient,
  plan: SeedPlan,
  userId: string,
): Promise<string> {
  const household = await tx.household.create({
    data: {
      name: plan.household.name,
      riskAppetite: plan.household.riskAppetite,
      monthlyIncomeCents: plan.household.monthlyIncomeCents,
    },
  });

  await tx.user.update({
    where: { id: userId },
    data: { householdId: household.id },
  });

  const categories = await Promise.all(
    plan.categories.map((category) =>
      tx.category.create({
        data: {
          householdId: household.id,
          group: category.group,
          name: category.name,
        },
        select: { id: true },
      }),
    ),
  );

  const month = await tx.month.create({
    data: {
      householdId: household.id,
      year: plan.month.year,
      month: plan.month.month,
      expectedIncomeCents: plan.month.expectedIncomeCents,
    },
    select: { id: true },
  });

  // $0 assigned everywhere: Ready to Assign starts at the entered income.
  await tx.allocation.createMany({
    data: categories.map((category) => ({
      monthId: month.id,
      categoryId: category.id,
      assignedCents: 0,
    })),
  });

  await tx.goal.create({
    data: {
      householdId: household.id,
      kind: plan.goal.kind,
      name: plan.goal.name,
      active: plan.goal.active,
    },
  });

  return household.id;
}
