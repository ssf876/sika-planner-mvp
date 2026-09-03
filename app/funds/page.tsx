import Link from "next/link";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import { listFundBoard } from "@/lib/repositories/funds";
import { listGoals } from "@/lib/repositories/goals";

import { FundsBoard } from "./funds-board";
import { GoalsPanel } from "./goals-panel";

export const metadata = { title: "Funds & goals — Sika Planner" };

/** Household-local calendar date (engine dates are YYYY-MM-DD, spec A4). */
function todayCalendarDate(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export default async function FundsPage() {
  const user = await requireOnboardedUser();
  const householdId = user.householdId;
  const today = todayCalendarDate();

  const [board, goals, accounts, categories] = await Promise.all([
    listFundBoard(prisma, householdId),
    listGoals(prisma, householdId),
    prisma.account.findMany({
      where: { householdId },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    // Categories without a fund yet — the only ones a new fund can back.
    prisma.category.findMany({
      where: { householdId, fundId: null },
      orderBy: [{ group: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return (
    <main>
      <header className="topbar">
        <h1>Funds &amp; goals</h1>
        <nav className="topbar-links">
          <Link href="/dashboard">Back to dashboard</Link>
        </nav>
      </header>

      <div className="stack">
        <FundsBoard
          funds={board.funds}
          month={board.month}
          accounts={accounts}
          categories={categories}
          today={today}
        />
        <GoalsPanel goals={goals} />
      </div>
    </main>
  );
}
