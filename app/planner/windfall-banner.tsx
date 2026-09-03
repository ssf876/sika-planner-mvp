"use client";

import { useMemo, useState } from "react";

import { applyWindfallLineAction } from "@/app/actions/windfall";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatCents } from "@/lib/money";
import {
  rankWindfallAllocation,
  type WindfallDetection,
  type WindfallIncomeRow,
  type WindfallLine,
  type WindfallRankContext,
} from "@/lib/planner/windfall";
import type { CategoryAvailable } from "@/src/engine";

import styles from "./planner.module.css";

export interface WindfallBannerProps {
  monthId: string;
  /** The month's income transactions, in date order. */
  incomeRows: WindfallIncomeRow[];
  detection: WindfallDetection;
  /** The month's expected income — the line the auto-flag measures against. */
  expectedIncomeCents: number;
  /** Ranking inputs from live state; the banner re-ranks on every render. */
  rankContext: WindfallRankContext;
  /** Adopt engine truth after an applied line assigns. */
  onAvailabilitySync: (next: CategoryAvailable[]) => void;
}

const TRANSPORT_ERROR =
  "We couldn't reach the planner — check your connection and try again.";

/**
 * The Allocate-windfall banner over the planner (D13). Lists the month's
 * income rows — each with the manual Allocate action, flagged with
 * "Unexpected income" when the A7 detector names it — and, once an amount is
 * chosen, the ranked proposal: overspent categories → sinking funds behind
 * their target date → the active goal weighted by appetite → remainder stays
 * in Ready to Assign. The proposal recomputes from the live ranking context
 * on every render (never stored), so an edited goal re-ranks it.
 */
export function WindfallBanner({
  monthId,
  incomeRows,
  detection,
  expectedIncomeCents,
  rankContext,
  onAvailabilitySync,
}: WindfallBannerProps) {
  const [windfallCents, setWindfallCents] = useState<number | null>(null);
  const [appliedLineIds, setAppliedLineIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);

  const flagged = useMemo(
    () => new Set(detection.flaggedTransactionIds),
    [detection.flaggedTransactionIds],
  );

  // Recomputed live from the render's ranking context — editing the active
  // goal re-renders this component with fresh context and re-ranks here.
  const proposal = useMemo(
    () =>
      windfallCents === null
        ? null
        : rankWindfallAllocation(rankContext, windfallCents),
    [rankContext, windfallCents],
  );
  const lines =
    proposal?.lines.filter((line) => !appliedLineIds.includes(line.lineId)) ??
    [];

  function allocateRow(row: WindfallIncomeRow) {
    setError(null);
    setWindfallCents(row.amountCents);
  }

  function allocateDetected() {
    setError(null);
    setWindfallCents(detection.windfallCents);
  }

  async function handleApply(line: WindfallLine) {
    setError(null);
    setBusyLineId(line.lineId);
    try {
      const result = await applyWindfallLineAction(monthId, line);
      if (!result.ok) {
        setError(result.error ?? "That suggestion didn't apply — try again.");
        return;
      }
      if (result.availability) onAvailabilitySync(result.availability);
      setAppliedLineIds((prev) => [...prev, line.lineId]);
    } catch (caught) {
      console.error("planner: windfall apply failed", caught);
      setError(TRANSPORT_ERROR);
    } finally {
      setBusyLineId(null);
    }
  }

  if (incomeRows.length === 0) return null;

  return (
    <Card data-testid="windfall-banner">
      <Card.Body>
        <div className={styles.windfallHeader}>
          <h2>Income this month</h2>
          {detection.windfallCents > 0 ? (
            <p className="hint">
              That&apos;s {formatCents(detection.windfallCents)} more than the{" "}
              {formatCents(expectedIncomeCents)} you expected — looks like a
              windfall.
            </p>
          ) : null}
        </div>

        <ul className={styles.windfallRows}>
          {incomeRows.map((row) => (
            <li
              key={row.transactionId}
              className={styles.windfallRow}
              data-testid={`windfall-row-${row.transactionId}`}
            >
              <span>{row.payee}</span>
              {flagged.has(row.transactionId) ? (
                <Badge tone="info">Unexpected income</Badge>
              ) : null}
              <span className={styles.windfallAmount}>
                {formatCents(row.amountCents)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Allocate ${row.payee}`}
                onClick={() => allocateRow(row)}
              >
                Allocate
              </Button>
            </li>
          ))}
        </ul>

        {detection.windfallCents > 0 ? (
          <Button size="sm" onClick={allocateDetected}>
            Allocate windfall
          </Button>
        ) : null}

        {proposal && lines.length > 0 ? (
          <div
            className={styles.windfallProposal}
            data-testid="windfall-proposal"
          >
            <h3>Suggested plan for {formatCents(proposal.windfallCents)}</h3>
            {error ? (
              <p role="alert" className="form-error">
                {error}
              </p>
            ) : null}
            <ol className={styles.windfallLines}>
              {lines.map((line) =>
                line.kind === "remainder" ? (
                  <li
                    key={line.lineId}
                    className={styles.windfallRemainder}
                    data-testid={`windfall-line-${line.lineId}`}
                  >
                    <span className="muted">{line.reason}</span>
                    <span className="muted">
                      {formatCents(line.suggestedCents)}
                    </span>
                  </li>
                ) : (
                  <li
                    key={line.lineId}
                    className={styles.windfallLine}
                    data-testid={`windfall-line-${line.lineId}`}
                  >
                    <Badge tone="info">Proposed</Badge>
                    <span>{line.name}</span>
                    <span className="muted">{line.reason}</span>
                    <span>Assign {formatCents(line.suggestedCents)}</span>
                    {line.kind === "goal" && !line.suggestedCategoryId ? (
                      <span className="muted">
                        No category to assign into yet — add one on the funds
                        board.
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => void handleApply(line)}
                        disabled={busyLineId !== null}
                        aria-label={`Apply ${line.name} suggestion`}
                      >
                        {busyLineId === line.lineId ? "Applying…" : "Apply"}
                      </Button>
                    )}
                  </li>
                ),
              )}
            </ol>
          </div>
        ) : null}
      </Card.Body>
    </Card>
  );
}
