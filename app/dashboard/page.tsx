import { AppShell } from "@/components/shell/AppShell";
import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import { getDashboardSnapshot } from "@/lib/repositories/dashboard";

import { DashboardView } from "./dashboard-view";

export const metadata = { title: "Dashboard — Sika Planner" };

/** Household-local calendar date (engine dates are YYYY-MM-DD, spec A4). */
function todayCalendarDate(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export default async function DashboardPage() {
  const user = await requireOnboardedUser();
  const snapshot = await getDashboardSnapshot(
    prisma,
    user.householdId,
    todayCalendarDate(),
  );

  return (
    <AppShell active="overview" title="Overview" email={user.email}>
      <DashboardView snapshot={snapshot} />
    </AppShell>
  );
}
