"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { parseIncomeToCents } from "@/lib/auth/validate";
import {
  applySeedPlan,
  buildSeedPlan,
  isHouseholdSize,
  type HouseholdSize,
} from "@/lib/onboarding/seed";

export interface OnboardingFormState {
  error: string | null;
}

export async function onboardAction(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const user = await requireUser();
  if (user.householdId) redirect("/dashboard");

  const topGoal = String(formData.get("topGoal") ?? "");
  if (topGoal !== "PAYOFF_DEBT" && topGoal !== "GROW_NET_WORTH") {
    return { error: "Choose your top money goal." };
  }

  const monthlyIncomeCents = parseIncomeToCents(
    String(formData.get("monthlyIncome") ?? ""),
  );
  if (monthlyIncomeCents === null) {
    return {
      error: "Enter your monthly income as a dollar amount, e.g. 5,000.",
    };
  }

  const householdSize = String(formData.get("householdSize") ?? "");
  if (!isHouseholdSize(householdSize)) {
    return { error: "Choose who will be using the app." };
  }

  const plan = buildSeedPlan(
    {
      topGoal,
      monthlyIncomeCents,
      householdSize: householdSize as HouseholdSize,
    },
    new Date(),
  );

  await prisma.$transaction((tx) => applySeedPlan(tx, plan, user.id));

  redirect("/dashboard");
}
