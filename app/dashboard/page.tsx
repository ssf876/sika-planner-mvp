import Link from "next/link";

import { prisma } from "@/lib/db";
import { signOutAction } from "@/app/actions/auth";
import { requireOnboardedUser } from "@/lib/auth/session";
import {
  CATEGORY_GROUP_ORDER,
  readyToAssignCents,
} from "@/lib/onboarding/seed";
import { formatCents } from "@/lib/money";
import type { CategoryGroup } from "@prisma/client";

export const metadata = { title: "Dashboard — Sika Planner" };

const GROUP_LABELS: Record<CategoryGroup, string> = {
  NEEDS: "Needs",
  WANTS: "Wants",
  SAVINGS_DEBTS: "Savings & Debts",
  INVESTMENTS: "Investments",
};

export default async function DashboardPage() {
  const user = await requireOnboardedUser();
  const householdId = user.householdId;

  const now = new Date();
  const month = await prisma.month.findUnique({
    where: {
      householdId_year_month: {
        householdId,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
      },
    },
    include: { allocations: { include: { category: true } } },
  });

  const monthName = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  ).toLocaleString("en-US", { month: "long" });

  return (
    <main>
      <header className="topbar">
        <h1>{month ? `${monthName} Budget` : "Sika Planner"}</h1>
        <nav className="topbar-links">
          <Link href="/transactions">Enter transactions</Link>
          <form action={signOutAction}>
            <button type="submit">Sign out</button>
          </form>
        </nav>
      </header>

      {month ? (
        <section className="stack">
          <div className="card">
            <h2>Ready to assign</h2>
            <p className="ready-to-assign">
              {formatCents(
                readyToAssignCents(
                  month.expectedIncomeCents,
                  month.allocations,
                ),
              )}
            </p>
            <p className="muted">
              You entered {formatCents(month.expectedIncomeCents)} of monthly
              income — assign every dollar in the planner until this is $0.00.
            </p>
          </div>

          {CATEGORY_GROUP_ORDER.map((group) => {
            const rows = month.allocations
              .filter((allocation) => allocation.category.group === group)
              .sort((a, b) => a.category.name.localeCompare(b.category.name));
            return (
              <section key={group} className="card">
                <h2>{GROUP_LABELS[group]}</h2>
                {rows.length === 0 ? (
                  <p className="muted">No categories here yet.</p>
                ) : (
                  rows.map((allocation) => (
                    <div key={allocation.id} className="category-row">
                      <span>{allocation.category.name}</span>
                      <span>
                        {formatCents(allocation.assignedCents)} assigned
                      </span>
                    </div>
                  ))
                )}
              </section>
            );
          })}

          <p className="muted">
            No transactions yet — spending you enter or import will show up here
            and deplete category availability in real time.
          </p>
        </section>
      ) : (
        <section className="card stack">
          <h2>No budget scaffolded yet</h2>
          <p className="muted">
            Your account is set up, but this month has no budget. Complete
            onboarding to scaffold it.
          </p>
        </section>
      )}
    </main>
  );
}
