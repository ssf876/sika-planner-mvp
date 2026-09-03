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
import type { MonthReport } from "@/lib/repositories/reports";

// The month retrospection card (D9): the three buckets — saved, popped up,
// went as planned — then the per-category ledger and the draw list behind them.

const VERDICT_LABELS = {
  saved: "Saved",
  overspent: "Overspent",
  "as-planned": "As planned",
} as const;

const VERDICT_TONES = {
  saved: "healthy",
  overspent: "overspent",
  "as-planned": "neutral",
} as const;

function signed(cents: number): string {
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

export function MonthReportSection({ report }: { report: MonthReport }) {
  const { report: pva } = report;
  return (
    <section className="card" aria-label={`Planned vs actual — ${report.label}`}>
      <h2>{report.label}</h2>

      <div className="month-strip">
        <div>
          <span>Saved</span>
          <strong>{formatCents(pva.savedTotalCents)}</strong>
        </div>
        <div>
          <span>Popped up</span>
          <strong>{formatCents(pva.poppedUpTotalCents)}</strong>
        </div>
        <div>
          <span>Went as planned</span>
          <strong>{formatCents(pva.asPlannedPlannedCents)}</strong>
        </div>
        <div>
          <span>Overspent</span>
          <strong>{formatCents(pva.overspentTotalCents)}</strong>
        </div>
      </div>
      <p className="muted">
        Saved = planned dollars that went unspent. Popped up = fund draws
        released this month — cashflow, never extra paycheck income. Went as
        planned = categories whose ordinary spending tracked the plan.
      </p>

      {report.categories.length === 0 ? (
        <p className="muted">
          Nothing recorded yet — income, assignments, and spending will split
          into saved, popped up, and went as planned here.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <tr>
              <TableHeaderCell>Category</TableHeaderCell>
              <TableHeaderCell>Planned</TableHeaderCell>
              <TableHeaderCell>Actual</TableHeaderCell>
              <TableHeaderCell>Popped up</TableHeaderCell>
              <TableHeaderCell>Left</TableHeaderCell>
              <TableHeaderCell>Verdict</TableHeaderCell>
            </tr>
          </TableHeader>
          <TableBody>
            {report.categories.map((row) => (
              <TableRow key={row.categoryId}>
                <TableCell>{row.categoryName}</TableCell>
                <TableCell>{formatCents(row.plannedCents)}</TableCell>
                <TableCell>{formatCents(row.actualCents)}</TableCell>
                <TableCell>{formatCents(row.poppedUpCents)}</TableCell>
                <TableCell>{signed(row.varianceCents)}</TableCell>
                <TableCell>
                  <Badge tone={VERDICT_TONES[row.verdict]}>
                    {VERDICT_LABELS[row.verdict]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {pva.draws.length > 0 ? (
        <div>
          <h3>Popped up</h3>
          <ul>
            {pva.draws.map((draw) => (
              <li key={draw.drawId}>
                {draw.fundName} — {formatCents(draw.amountCents)}
                {draw.paidExpense
                  ? ` (paid ${draw.expensePayee ?? "the expense"})`
                  : " (drawn from the static goal)"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="muted">
        Income received {formatCents(pva.incomeReceivedCents)} · net cashflow{" "}
        {formatCents(pva.netCashflowCents)}
      </p>
    </section>
  );
}
