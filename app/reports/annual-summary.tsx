import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { formatCents } from "@/lib/money";
import type { AnnualReport } from "@/lib/repositories/reports";

// The year-in-review card (D9): the savings rate, the 12-month net-worth
// trend, major pop-up life events, and confirmed seasons — one view of the
// year built from the same month reports the retrospection page shows.

const SEASON_LABELS = {
  HOME_PURCHASE: "Home purchase",
  MOVE: "Move",
  WEDDING: "Wedding",
  CHILD: "Child",
  CUSTOM: "Life event",
} as const;

/** Twelve evenly spaced SVG points from the trend, min/max-scaled. */
function sparklinePoints(netWorthCents: number[]): string {
  const min = Math.min(...netWorthCents);
  const max = Math.max(...netWorthCents);
  const span = max - min;
  return netWorthCents
    .map((value, index) => {
      const x = (index / (netWorthCents.length - 1)) * 100;
      const y = span === 0 ? 18 : 18 - ((value - min) / span) * 16;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function AnnualSummarySection({ report }: { report: AnnualReport }) {
  const { summary } = report;
  const trend = summary.netWorthTrend.map((point) => point.netWorthCents);

  return (
    <section className="card" aria-label={`${report.year} in review`}>
      <h2>{report.year} in review</h2>

      <div className="month-strip">
        <div>
          <span>Savings rate</span>
          <strong>
            {summary.savingsRatePercent === null
              ? "—"
              : `${summary.savingsRatePercent}%`}
          </strong>
        </div>
        <div>
          <span>Income received</span>
          <strong>{formatCents(summary.totalIncomeCents)}</strong>
        </div>
        <div>
          <span>Popped up</span>
          <strong>{formatCents(summary.totalPoppedUpCents)}</strong>
        </div>
        <div>
          <span>Saved</span>
          <strong>{formatCents(summary.totalSavedCents)}</strong>
        </div>
        <div>
          <span>Overspent</span>
          <strong>{formatCents(summary.totalOverspentCents)}</strong>
        </div>
      </div>

      <div>
        <h3>Net worth</h3>
        <svg
          viewBox="0 0 100 24"
          role="img"
          aria-label={`Net worth from ${formatCents(report.netWorthStartCents)} in January to ${formatCents(report.netWorthEndCents)} in December`}
          preserveAspectRatio="none"
        >
          <polyline
            points={sparklinePoints(trend)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
        <p className="muted">
          {formatCents(report.netWorthStartCents)} in January ·{" "}
          {formatCents(report.netWorthEndCents)} in December
        </p>
      </div>

      {summary.months.length === 0 ? (
        <p className="muted">
          No budgeted months in {report.year} yet — the year fills in as you
          plan and spend.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <tr>
              <TableHeaderCell>Month</TableHeaderCell>
              <TableHeaderCell>Income</TableHeaderCell>
              <TableHeaderCell>Popped up</TableHeaderCell>
              <TableHeaderCell>Spending</TableHeaderCell>
              <TableHeaderCell>Net</TableHeaderCell>
              <TableHeaderCell>Saved</TableHeaderCell>
              <TableHeaderCell>Overspent</TableHeaderCell>
            </tr>
          </TableHeader>
          <TableBody>
            {summary.months.map((month) => (
              <TableRow key={month.monthId}>
                <TableCell>{month.label}</TableCell>
                <TableCell>{formatCents(month.incomeReceivedCents)}</TableCell>
                <TableCell>{formatCents(month.poppedUpCents)}</TableCell>
                <TableCell>{formatCents(month.spendingCents)}</TableCell>
                <TableCell>{formatCents(month.netCashflowCents)}</TableCell>
                <TableCell>{formatCents(month.savedCents)}</TableCell>
                <TableCell>{formatCents(month.overspentCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="stack">
        <div>
          <h3>Major pop-ups</h3>
          {summary.majorPopUps.length === 0 ? (
            <p className="muted">No life-event-sized draws this year.</p>
          ) : (
            <ul>
              {summary.majorPopUps.map((popUp) => (
                <li key={popUp.drawId}>
                  {popUp.monthLabel} — {popUp.fundName}{" "}
                  {formatCents(popUp.amountCents)}
                  {popUp.paidExpense
                    ? ` (paid ${popUp.expensePayee ?? "the expense"})`
                    : " (drawn from the static goal)"}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3>Confirmed life seasons</h3>
          {summary.confirmedSeasons.length === 0 ? (
            <p className="muted">No confirmed seasons started this year.</p>
          ) : (
            <ul>
              {summary.confirmedSeasons.map((season) => (
                <li key={season.id}>
                  <Badge tone="info">{SEASON_LABELS[season.kind]}</Badge>{" "}
                  {season.seasonStart}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
