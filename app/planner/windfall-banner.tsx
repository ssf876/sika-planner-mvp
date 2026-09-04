"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { applyWindfallLineAction } from "@/app/actions/windfall";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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

const APPLIED_BEAT_MS = 1400;

/**
 * The Allocate-windfall banner over the planner (D13), spoken in the Sika
 * recommendation language: what Sika noticed, what is suggested, and what
 * changes if applied. Lists the month's income rows — each with the manual
 * Allocate action, flagged with "Unexpected income" when the A7 detector
 * names it — and, once an amount is chosen, the ranked proposal: overspent
 * categories → sinking funds behind their target date → the active goal
 * weighted by appetite → remainder stays in Ready to Assign. Lines show a
 * brief Applied beat before collapsing; Not now dismisses quietly. Nothing
 * mutates before the user's explicit Apply.
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
  /**
   * Confirmations for applied lines, shown for a brief beat. Held in their
   * own state — not read off the live ranking — because applying also syncs
   * availability, and the re-ranked proposal drops the now-cured line
   * immediately; the confirmation must outlive that re-rank.
   */
  const [appliedNotes, setAppliedNotes] = useState<
    { lineId: string; name: string; suggestedCents: number }[]
  >([]);
  /** Applied lines after the beat — collapsed out of the plan. */
  const [collapsedLineIds, setCollapsedLineIds] = useState<string[]>([]);
  /** Quietly dismissed suggestions — never applied, never persisted. */
  const [dismissedLineIds, setDismissedLineIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);

  const appliedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
    },
    [],
  );

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
    proposal?.lines.filter(
      (line) =>
        !collapsedLineIds.includes(line.lineId) &&
        !dismissedLineIds.includes(line.lineId) &&
        !appliedNotes.some((note) => note.lineId === line.lineId),
    ) ?? [];

  function allocateRow(row: WindfallIncomeRow) {
    setError(null);
    setWindfallCents(row.amountCents);
  }

  function allocateDetected() {
    setError(null);
    setWindfallCents(detection.windfallCents);
  }

  function handleDismiss(lineId: string) {
    setDismissedLineIds((prev) => [...prev, lineId]);
  }

  async function handleApply(line: WindfallLine) {
    setError(null);
    setBusyLineId(line.lineId);
    try {
      // Remainder lines render no Apply button; this narrows the type only.
      if (line.kind === "remainder") return;
      const applied = {
        lineId: line.lineId,
        name: line.name,
        suggestedCents: line.suggestedCents,
      };
      const result = await applyWindfallLineAction(monthId, line);
      if (!result.ok) {
        setError(result.error ?? "That suggestion didn't apply — try again.");
        return;
      }
      if (result.availability) onAvailabilitySync(result.availability);
      // Brief Applied beat — held in its own state so the live re-rank (the
      // apply just cured this line) can't swallow it — then the note clears.
      setAppliedNotes((prev) => [...prev, applied]);
      if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
      appliedTimerRef.current = setTimeout(() => {
        setCollapsedLineIds((prev) => [...prev, line.lineId]);
        setAppliedNotes((prev) =>
          prev.filter((note) => note.lineId !== line.lineId),
        );
      }, APPLIED_BEAT_MS);
    } catch (caught) {
      console.error("planner: windfall apply failed", caught);
      setError(TRANSPORT_ERROR);
    } finally {
      setBusyLineId(null);
    }
  }

  if (incomeRows.length === 0) return null;

  return (
    <div className={styles.recommendationCard} data-testid="windfall-banner">
      <p className={styles.recommendationHeading}>What Sika noticed</p>
      <h2 className={styles.recommendationNotice}>Income this month</h2>
      {detection.windfallCents > 0 ? (
        <p className="hint">
          That&apos;s {formatCents(detection.windfallCents)} more than the{" "}
          {formatCents(expectedIncomeCents)} you expected — looks like a
          windfall.
        </p>
      ) : null}

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
          <h3 className={styles.proposalTitle}>
            Suggested plan for {formatCents(proposal.windfallCents)}
          </h3>
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
                  <span className={styles.proposalTitle}>{line.name}</span>
                  <span className={styles.proposalDetail}>{line.reason}</span>
                  <span>Assign {formatCents(line.suggestedCents)}</span>
                  <div className={styles.proposalActions}>
                    {line.kind === "goal" && !line.suggestedCategoryId ? (
                      <span className="muted">
                        No category to assign into yet — add one under Funds
                        &amp; goals.
                      </span>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() => void handleApply(line)}
                          disabled={busyLineId !== null}
                          aria-label={`Apply ${line.name} suggestion`}
                        >
                          {busyLineId === line.lineId ? "Applying…" : "Apply"}
                        </Button>
                        <button
                          type="button"
                          className={styles.proposalDismiss}
                          onClick={() => handleDismiss(line.lineId)}
                          disabled={busyLineId !== null}
                        >
                          Not now
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ),
            )}
          </ol>
          {appliedNotes.map((note) => (
            <p
              key={note.lineId}
              className={styles.appliedNote}
              data-visible="true"
              role="status"
            >
              Applied — {formatCents(note.suggestedCents)} to {note.name}.
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
