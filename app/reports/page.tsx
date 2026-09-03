import Link from "next/link";

import { requireOnboardedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { listMonthReport } from "@/lib/repositories/reports";

import { MonthReportSection } from "./month-report";

export const metadata = { title: "Planned vs actual — Sika Planner" };

// Month retrospection (D9): the plan vs what actually happened, one month at
// a time, with prev/next navigation. The annual summary lives on this page too
// (added by the annual view), fed by the same report math.

const MONTH_PARAM = /^\d{4}-(?:0[1-9]|1[0-2])$/;

interface SelectedMonth {
  year: number;
  month: number;
}

function currentMonth(): SelectedMonth {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function parseMonthParam(raw: string | undefined): SelectedMonth | null {
  if (!raw || !MONTH_PARAM.test(raw)) return null;
  const [year, month] = raw.split("-").map(Number);
  return { year: year as number, month: month as number };
}

function shiftMonth({ year, month }: SelectedMonth, delta: number): SelectedMonth {
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

function monthParam({ year, month }: SelectedMonth): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const selected = parseMonthParam(params.month) ?? currentMonth();

  const report = await listMonthReport(prisma, user.householdId, selected);
  const previous = shiftMonth(selected, -1);
  const next = shiftMonth(selected, 1);

  return (
    <main>
      <header className="topbar">
        <h1>Planned vs actual</h1>
        <nav className="topbar-links">
          <Link href={`/reports?month=${monthParam(previous)}`}>
            ‹ {previous.year === selected.year ? "" : `${previous.year} `}
            Previous
          </Link>
          <Link href={`/reports?month=${monthParam(next)}`}>
            Next
            {next.year === selected.year ? "" : ` ${next.year}`} ›
          </Link>
          <Link href="/dashboard">Back to dashboard</Link>
        </nav>
      </header>

      <div className="stack">
        {report ? (
          <MonthReportSection report={report} />
        ) : (
          <section className="card stack">
            <h2>No budget for this month yet</h2>
            <p className="muted">
              Once this month has a budget and some spending, the split into
              saved, popped up, and went as planned shows up here.
            </p>
            <p>
              <Link href="/dashboard">Open the dashboard to assign dollars</Link>
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
