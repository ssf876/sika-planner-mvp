import { redirect } from "next/navigation";

import { OnboardingForm } from "./onboarding-form";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Welcome — Sika Planner" };

export default async function OnboardingPage() {
  const user = await requireUser();
  // Fully onboarded users have nothing to answer here.
  if (user.householdId) redirect("/dashboard");

  return (
    <section className="stack">
      <h1>Welcome to Sika Planner</h1>
      <p>Three quick answers and your first budget is ready to assign.</p>
      <OnboardingForm />
    </section>
  );
}
