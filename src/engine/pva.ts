// Planned-vs-Actual report math (D9) — pure functions over EngineState, the
// same discipline as danger.ts: no DB, no framework, exhaustively testable.
//
// The month report splits every category against its plan —
//   saved        planned dollars that went unspent
//   popped up    fund draws released this month (sinking pop-ups + static draws)
//   as-planned   categories whose ordinary spending tracked the plan
// — so the plan answers "what was saved, what popped up, what went as
// planned" without anyone doing mental arithmetic over the ledger.

import { EngineError } from "./errors";
import { calendarMonth } from "./invariants";
import type {
  AnnualMonthRow,
  AnnualSummary,
  AnnualSummaryOptions,
  EngineState,
  FundDraw,
  MajorPopUpRow,
  MonthCashflow,
  NetWorthPoint,
  PlannedVsActualReport,
  PvaCategoryRow,
  PvaDrawRow,
  PvaOptions,
  PvaVerdict,
} from "./types";

export const DEFAULT_AS_PLANNED_BAND_PERCENT = 10;
export const DEFAULT_MAJOR_POP_UP_CENTS = 50_000;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
] as const;

export function monthLabelOf(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function requireMonth(state: EngineState, monthId: string) {
  const month = state.months.find((m) => m.id === monthId);
  if (!month)
    throw new EngineError("UNKNOWN_MONTH", `no month with id "${monthId}"`);
  return month;
}

const sameCalendarMonth = (
  date: string,
  target: { year: number; month: number },
): boolean => {
  const { year, month } = calendarMonth(date);
  return year === target.year && month === target.month;
};

/**
 * One derivation of the month cashflow ledger. engine.monthCashflow and the
 * report math both read from here, so the two views can never drift.
 */
export function computeMonthCashflow(
  state: EngineState,
  monthId: string,
): MonthCashflow {
  const month = requireMonth(state, monthId);
  const inMonth = state.transactions.filter((tx) =>
    sameCalendarMonth(tx.date, month),
  );
  const incomeReceivedCents = inMonth
    .filter((tx) => tx.kind === "INCOME")
    .reduce((sum, tx) => sum + tx.amountCents, 0);
  const spendingCents = inMonth
    .filter((tx) => tx.kind === "EXPENSE")
    .reduce((sum, tx) => sum - tx.amountCents, 0);
  const fundDrawCents = state.fundDraws
    .filter((d) => d.monthId === monthId)
    .reduce((sum, d) => sum + d.amountCents, 0);
  return {
    monthId: month.id,
    incomeReceivedCents,
    fundDrawCents,
    spendingCents,
    netCashflowCents: incomeReceivedCents + fundDrawCents - spendingCents,
  };
}

/** The draw ledger of one month, largest draw first — the "popped up" list. */
export function drawRowsFor(state: EngineState, monthId: string): PvaDrawRow[] {
  const month = requireMonth(state, monthId);
  return state.fundDraws
    .filter((d) => d.monthId === month.id)
    .map((d) => drawRowFor(state, d))
    .sort(
      (a, b) =>
        b.amountCents - a.amountCents || a.fundName.localeCompare(b.fundName),
    );
}

function drawRowFor(state: EngineState, draw: FundDraw): PvaDrawRow {
  const fund = state.funds.find((f) => f.id === draw.fundId);
  if (!fund) {
    throw new EngineError(
      "UNKNOWN_FUND",
      `fund draw "${draw.id}" references a fund missing from the state`,
    );
  }
  // A sinking pop-up pays an expense transaction; static draws are uncoupled.
  const expense = state.transactions.find((t) => t.fundDrawId === draw.id);
  return {
    drawId: draw.id,
    fundId: draw.fundId,
    fundName: fund.name,
    fundKind: fund.kind,
    amountCents: draw.amountCents,
    paidExpense: expense !== undefined,
    expensePayee: expense?.payee,
  };
}

/**
 * The Planned-vs-Actual month report: every category with a plan or activity
 * is classified against its allocation, and the month's draws are listed.
 */
export function buildPlannedVsActual(
  state: EngineState,
  monthId: string,
  options: PvaOptions = {},
): PlannedVsActualReport {
  const bandPercent =
    options.asPlannedBandPercent ?? DEFAULT_AS_PLANNED_BAND_PERCENT;
  const cashflow = computeMonthCashflow(state, monthId);
  const target = stateMonthTarget(state, monthId);

  const categories: PvaCategoryRow[] = [];
  for (const category of state.categories) {
    const plannedCents =
      state.allocations.find(
        (a) => a.monthId === monthId && a.categoryId === category.id,
      )?.assignedCents ?? 0;

    // Split actual spending: pop-up expenses were covered by a fund draw and
    // report under "popped up"; the rest is what the plan had to absorb.
    let poppedUpCents = 0;
    let ordinarySpentCents = 0;
    for (const tx of state.transactions) {
      if (tx.kind !== "EXPENSE" || tx.categoryId !== category.id) continue;
      if (!sameCalendarMonth(tx.date, target)) continue;
      if (tx.fundDrawId != null) poppedUpCents += -tx.amountCents;
      else ordinarySpentCents += -tx.amountCents;
    }

    if (plannedCents === 0 && poppedUpCents === 0 && ordinarySpentCents === 0)
      continue;

    const band = Math.floor((plannedCents * bandPercent) / 100);
    const varianceCents = plannedCents - ordinarySpentCents;
    const verdict: PvaVerdict =
      Math.abs(varianceCents) <= band
        ? "as-planned"
        : varianceCents > 0
          ? "saved"
          : "overspent";

    categories.push({
      categoryId: category.id,
      plannedCents,
      actualCents: poppedUpCents + ordinarySpentCents,
      poppedUpCents,
      ordinarySpentCents,
      varianceCents,
      verdict,
    });
  }

  const savedTotalCents = categories
    .filter((row) => row.verdict === "saved")
    .reduce((sum, row) => sum + row.varianceCents, 0);
  const overspentTotalCents = categories
    .filter((row) => row.verdict === "overspent")
    .reduce((sum, row) => sum - row.varianceCents, 0);
  const asPlannedPlannedCents = categories
    .filter((row) => row.verdict === "as-planned")
    .reduce((sum, row) => sum + row.plannedCents, 0);

  return {
    monthId,
    plannedTotalCents: categories.reduce(
      (sum, row) => sum + row.plannedCents,
      0,
    ),
    actualTotalCents: categories.reduce((sum, row) => sum + row.actualCents, 0),
    savedTotalCents,
    overspentTotalCents,
    asPlannedPlannedCents,
    poppedUpTotalCents: cashflow.fundDrawCents,
    incomeReceivedCents: cashflow.incomeReceivedCents,
    netCashflowCents: cashflow.netCashflowCents,
    categories,
    draws: drawRowsFor(state, monthId),
  };
}

/** Last calendar day of the month as ISO "YYYY-MM-DD" (end-of-month cutoffs). */
export function lastDayOfMonth(year: number, month: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * The annual summary: the year's budgeted months aggregated (savings rate,
 * saved/overspent/popped-up rollups), the net-worth trend as of each month's
 * last day, the draws big enough to be life events, and the confirmed
 * seasons that started this year.
 */
export function buildAnnualSummary(
  state: EngineState,
  year: number,
  options: AnnualSummaryOptions = {},
): AnnualSummary {
  const thresholdCents =
    options.majorPopUpThresholdCents ?? DEFAULT_MAJOR_POP_UP_CENTS;

  const months: AnnualMonthRow[] = state.months
    .filter((m) => m.year === year)
    .sort((a, b) => a.month - b.month)
    .map((m) => {
      const report = buildPlannedVsActual(state, m.id);
      return {
        monthId: m.id,
        month: m.month,
        label: monthLabelOf(m.year, m.month),
        plannedTotalCents: report.plannedTotalCents,
        incomeReceivedCents: report.incomeReceivedCents,
        poppedUpCents: report.poppedUpTotalCents,
        spendingCents: report.actualTotalCents,
        netCashflowCents: report.netCashflowCents,
        savedCents: report.savedTotalCents,
        overspentCents: report.overspentTotalCents,
        asPlannedPlannedCents: report.asPlannedPlannedCents,
      };
    });

  const totalIncomeCents = months.reduce(
    (sum, m) => sum + m.incomeReceivedCents,
    0,
  );
  const totalPoppedUpCents = months.reduce(
    (sum, m) => sum + m.poppedUpCents,
    0,
  );
  const totalSpendingCents = months.reduce(
    (sum, m) => sum + m.spendingCents,
    0,
  );
  const totalSavedCents = months.reduce((sum, m) => sum + m.savedCents, 0);
  const totalOverspentCents = months.reduce(
    (sum, m) => sum + m.overspentCents,
    0,
  );

  // Savings rate on the month-cashflow definition: fund draws count as the
  // month's inflow (spec money semantics), pop-up spending as outflow.
  const inflowCents = totalIncomeCents + totalPoppedUpCents;
  const netCents = inflowCents - totalSpendingCents;
  const savingsRatePercent =
    inflowCents > 0 ? Math.floor((netCents * 100) / inflowCents) : null;

  // Net worth = Σ account balances. Starting balances plus every signed
  // transaction dated through the month's last day; transfers move money
  // between the household's own accounts, so they never change the total.
  const startingCents = state.accounts.reduce(
    (sum, a) => sum + a.startingCents,
    0,
  );
  const netWorthTrend: NetWorthPoint[] = [];
  for (let month = 1; month <= 12; month++) {
    const cutoff = lastDayOfMonth(year, month);
    const txSum = state.transactions
      .filter((tx) => tx.date <= cutoff)
      .reduce((sum, tx) => sum + tx.amountCents, 0);
    netWorthTrend.push({
      month,
      label: monthLabelOf(year, month),
      netWorthCents: startingCents + txSum,
    });
  }

  const majorPopUps = state.fundDraws
    .filter((d) => d.amountCents >= thresholdCents)
    .map((d) => {
      const drawMonth = state.months.find((m) => m.id === d.monthId);
      if (!drawMonth || drawMonth.year !== year) return null;
      return {
        ...drawRowFor(state, d),
        monthId: drawMonth.id,
        monthLabel: monthLabelOf(drawMonth.year, drawMonth.month),
      };
    })
    .filter((row): row is MajorPopUpRow => row !== null)
    .sort(
      (a, b) =>
        b.amountCents - a.amountCents || a.fundName.localeCompare(b.fundName),
    );

  const confirmedSeasons = (options.confirmedLifeEvents ?? [])
    .filter(
      (event) =>
        event.seasonStart !== undefined &&
        calendarMonth(event.seasonStart).year === year,
    )
    .sort((a, b) =>
      (a.seasonStart ?? "") < (b.seasonStart ?? "") ? -1 : 1,
    );

  return {
    year,
    savingsRatePercent,
    totalIncomeCents,
    totalPoppedUpCents,
    totalSpendingCents,
    totalSavedCents,
    totalOverspentCents,
    months,
    netWorthTrend,
    majorPopUps,
    confirmedSeasons,
  };
}

function stateMonthTarget(
  state: EngineState,
  monthId: string,
): { year: number; month: number } {
  const month = requireMonth(state, monthId);
  return { year: month.year, month: month.month };
}
