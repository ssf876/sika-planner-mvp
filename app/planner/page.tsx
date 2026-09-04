import { AppShell } from "@/components/shell/AppShell";
import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import { getPlannerSnapshot } from "@/lib/repositories/planner";
import { proposeSeasonPlan } from "@/lib/repositories/life-events";
import { getWindfallContext } from "@/lib/repositories/windfall";

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

  // Advisor seam (D12): confirmed life-event seasons become planner
  // proposals for this month. The grid renders whatever arrives — applying
  // a line only through the user's explicit Apply on the proposal row.
  const proposals = await proposeSeasonPlan(
    prisma,
    user.householdId,
    snapshot.monthId,
  );

  // D13 advisor surface: the month's income rows, the unexpected-income
  // detection over them, and the live ranking inputs. The banner re-ranks
  // client-side on every render, so an edited goal re-ranks immediately.
  const windfall = await getWindfallContext(
    prisma,
    user.householdId,
    snapshot.monthId,
  );

  return (
    <AppShell
      active="plan"
      title={`${monthTitle(snapshot.year, snapshot.month)} planner`}
      email={user.email}
    >
      <PlannerView
        monthId={snapshot.monthId}
        incomeReceivedCents={snapshot.incomeReceivedCents}
        hasPreviousMonth={snapshot.hasPreviousMonth}
        categories={snapshot.categories}
        initialAvailability={snapshot.availability}
        proposals={proposals}
        windfall={windfall}
      />
    </AppShell>
  );
}
