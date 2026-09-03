import Link from "next/link";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import { getPlannerSnapshot } from "@/lib/repositories/planner";

import { PlannerView } from "./planner-view";

export const metadata = { title: "Monthly planner — Sika Planner" };

/** Household-local calendar date (engine dates are YYYY-MM-DD, spec A4). */
function todayCalendarDate(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/** "September 2026" — computed server-side so locale is deterministic. */
function monthTitle(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function PlannerPage() {
  const user = await requireOnboardedUser();
  const snapshot = await getPlannerSnapshot(
    prisma,
    user.householdId,
    todayCalendarDate(),
  );

  return (
    <main>
      <header className="topbar">
        <h1>{monthTitle(snapshot.year, snapshot.month)} planner</h1>
        <Link href="/dashboard">Back to dashboard</Link>
      </header>

      <PlannerView
        monthId={snapshot.monthId}
        incomeReceivedCents={snapshot.incomeReceivedCents}
        hasPreviousMonth={snapshot.hasPreviousMonth}
        categories={snapshot.categories}
        initialAvailability={snapshot.availability}
      />
    </main>
  );
}
