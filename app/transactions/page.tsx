import Link from "next/link";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";

import { TransactionEntryForm } from "./entry-form";
import { TransferForm } from "./transfer-form";

export const metadata = { title: "Enter transactions — Sika Planner" };

/** Household-local calendar date (engine dates are YYYY-MM-DD, spec A4). */
function todayCalendarDate(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export default async function TransactionsPage() {
  const user = await requireOnboardedUser();
  const householdId = user.householdId;
  const today = todayCalendarDate();

  const [accounts, categories] = await Promise.all([
    prisma.account.findMany({
      where: { householdId },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.category.findMany({
      where: { householdId },
      orderBy: [{ group: "asc" }, { name: "asc" }],
      select: { id: true, name: true, group: true },
    }),
  ]);

  return (
    <main>
      <header className="topbar">
        <h1>Enter transactions</h1>
        <Link href="/dashboard">Back to dashboard</Link>
      </header>

      <div className="stack">
        <section className="card">
          <h2>Manual entry</h2>
          <p className="hint">
            Spending depletes its category immediately; income raises Ready to
            Assign.
          </p>
          {accounts.length > 0 ? (
            <TransactionEntryForm
              accounts={accounts}
              categories={categories}
              today={today}
            />
          ) : (
            <p className="hint">
              Add an account on the dashboard before recording transactions.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Transfer between accounts</h2>
          <p className="hint">
            Card payments, ATM withdrawals, moving cash — never spending.
          </p>
          {accounts.length >= 2 ? (
            <TransferForm accounts={accounts} today={today} />
          ) : (
            <p className="hint">
              Transfers need two accounts — add another one first.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
