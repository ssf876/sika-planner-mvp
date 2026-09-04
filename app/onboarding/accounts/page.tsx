import { redirect } from "next/navigation";

import { AccountSetupForm } from "./account-setup-form";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Set up your first account — Sika Planner" };

export default async function AccountSetupPage() {
  const user = await requireUser();
  // The account step belongs to onboarding: answer the three questions first.
  if (!user.householdId) redirect("/onboarding");

  return (
    <section className="stack">
      <h1>Set up your first account</h1>
      <p>
        Transactions need somewhere to live. Start with the account you use day
        to day — you can add another right after this one.
      </p>
      <AccountSetupForm />
    </section>
  );
}
