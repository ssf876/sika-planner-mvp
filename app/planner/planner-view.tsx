"use client";

import { useMemo, useState } from "react";

import {
  applyProposalAction,
  assignCategoryAction,
  copyPreviousMonthAction,
  type PlannerActionResult,
} from "@/app/actions/planner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { classifySpendState } from "@/components/ui/danger-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/Table";
import type { DangerTone } from "@/components/ui/types";
import { parseIncomeToCents } from "@/lib/auth/validate";
import type { PlannerProposal } from "@/lib/planner/proposals";
import { formatCents } from "@/lib/money";
import type { CategoryAvailable, CategoryGroup } from "@/src/engine";

import styles from "./planner.module.css";

const GROUP_ORDER: readonly CategoryGroup[] = [
  "NEEDS",
  "WANTS",
  "SAVINGS_DEBTS",
  "INVESTMENTS",
];

const GROUP_LABELS: Record<CategoryGroup, string> = {
  NEEDS: "Needs",
  WANTS: "Wants",
  SAVINGS_DEBTS: "Savings & Debts",
  INVESTMENTS: "Investments",
};

export interface PlannerCategory {
  id: string;
  name: string;
  group: CategoryGroup;
}

export interface PlannerViewProps {
  monthId: string;
  /** Income transactions received this month — the only RTA input. */
  incomeReceivedCents: number;
  hasPreviousMonth: boolean;
  categories: PlannerCategory[];
  initialAvailability: CategoryAvailable[];
  proposals: PlannerProposal[];
}

/** Plain-dollars text for assign inputs; blank for unassigned rows. */
export function formatCentsForInput(cents: number): string {
  return cents === 0 ? "" : (cents / 100).toFixed(2);
}

function assignmentsOf(
  availability: CategoryAvailable[],
): Record<string, number> {
  return Object.fromEntries(
    availability.map((a) => [a.categoryId, a.assignedCents]),
  );
}

function draftsOf(availability: CategoryAvailable[]): Record<string, string> {
  return Object.fromEntries(
    availability.map((a) => [
      a.categoryId,
      formatCentsForInput(a.assignedCents),
    ]),
  );
}

const TRANSPORT_ERROR =
  "We couldn't reach the planner — check your connection and try again.";

/**
 * The monthly planner grid (D6): per-category zero-based assignment with a
 * live Ready-to-Assign indicator, copy-previous-month, overspent warnings,
 * and advisor-proposed rows that mutate nothing until Apply is clicked.
 */
export function PlannerView({
  monthId,
  incomeReceivedCents,
  hasPreviousMonth,
  categories,
  initialAvailability,
  proposals: initialProposals,
}: PlannerViewProps) {
  const [assignments, setAssignments] = useState(() =>
    assignmentsOf(initialAvailability),
  );
  const [availability, setAvailability] = useState(initialAvailability);
  const [drafts, setDrafts] = useState(() => draftsOf(initialAvailability));
  const [proposals, setProposals] = useState(initialProposals);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // The zero-based target: income received minus what the plan assigns,
  // including unsaved drafts so the indicator moves as you type.
  const readyToAssignCents = useMemo(() => {
    const assigned = categories.reduce((sum, category) => {
      const draft = parseIncomeToCents(drafts[category.id] ?? "");
      return sum + (draft ?? assignments[category.id] ?? 0);
    }, 0);
    return incomeReceivedCents - assigned;
  }, [categories, drafts, assignments, incomeReceivedCents]);

  const availableById = useMemo(
    () => new Map(availability.map((a) => [a.categoryId, a] as const)),
    [availability],
  );

  /** Adopt the engine truth returned by a persisted op. */
  function syncFromServer(next: CategoryAvailable[]) {
    setAvailability(next);
    setAssignments(assignmentsOf(next));
    // A draft that no longer matches the committed assignment is stale —
    // e.g. after applying a proposal or copying last month — so adopt the
    // server value. Untouched drafts on unchanged rows are preserved.
    setDrafts((prev) => {
      const nextDrafts = { ...prev };
      for (const a of next) {
        if ((assignments[a.categoryId] ?? 0) !== a.assignedCents) {
          nextDrafts[a.categoryId] = formatCentsForInput(a.assignedCents);
        }
      }
      return nextDrafts;
    });
  }

  async function handleAssign(categoryId: string) {
    setError(null);
    setBusyKey(`assign:${categoryId}`);
    try {
      const result: PlannerActionResult = await assignCategoryAction(
        monthId,
        categoryId,
        drafts[categoryId] ?? "",
      );
      if (!result.ok || !result.availability) {
        setError(result.error ?? "That assignment didn't save — try again.");
        return;
      }
      syncFromServer(result.availability);
    } catch (caught) {
      console.error("planner: assign failed", caught);
      setError(TRANSPORT_ERROR);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleApply(proposal: PlannerProposal) {
    setError(null);
    setBusyKey(`apply:${proposal.id}`);
    try {
      const result = await applyProposalAction(monthId, proposal);
      if (!result.ok || !result.availability) {
        setError(result.error ?? "That proposal didn't apply — try again.");
        return;
      }
      syncFromServer(result.availability);
      setProposals((prev) => prev.filter((p) => p.id !== proposal.id));
    } catch (caught) {
      console.error("planner: apply failed", caught);
      setError(TRANSPORT_ERROR);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCopy() {
    setError(null);
    setBusyKey("copy");
    try {
      const result = await copyPreviousMonthAction(monthId);
      if (!result.ok || !result.availability) {
        setError(result.error ?? "Couldn't copy last month — try again.");
        return;
      }
      syncFromServer(result.availability);
    } catch (caught) {
      console.error("planner: copy failed", caught);
      setError(TRANSPORT_ERROR);
    } finally {
      setBusyKey(null);
    }
  }

  if (categories.length === 0) {
    return (
      <p className="hint">
        No categories yet — finish onboarding to scaffold your first month.
      </p>
    );
  }

  return (
    <div className="stack">
      <Card>
        <Card.Body>
          <div className={styles.summaryRow} aria-live="polite">
            <div className={styles.summaryRta}>
              <span className="muted">Ready to assign</span>
              <strong
                className={readyToAssignCents < 0 ? styles.negative : undefined}
                data-testid="ready-to-assign"
              >
                {formatCents(readyToAssignCents)}
              </strong>
            </div>
            {readyToAssignCents === 0 ? (
              <Badge tone="healthy">Every dollar assigned</Badge>
            ) : readyToAssignCents < 0 ? (
              <Badge tone="overspent">Over-assigned</Badge>
            ) : (
              <Badge tone="info">Assign every dollar</Badge>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleCopy()}
              disabled={!hasPreviousMonth || busyKey !== null}
              aria-label="Copy last month's assignments"
            >
              {busyKey === "copy" ? "Copying…" : "Copy last month"}
            </Button>
          </div>
          {!hasPreviousMonth ? (
            <p className="hint">
              No previous month to copy yet — this planner starts fresh.
            </p>
          ) : null}
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
          <Table>
            <TableHeader>
              <tr>
                <TableHeaderCell>Category</TableHeaderCell>
                <TableHeaderCell>Assigned</TableHeaderCell>
                <TableHeaderCell>Spent</TableHeaderCell>
                <TableHeaderCell>Available</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </tr>
            </TableHeader>
            <TableBody>
              {GROUP_ORDER.flatMap((group) => {
                const inGroup = categories.filter((c) => c.group === group);
                if (inGroup.length === 0) return [];
                return [
                  <TableRow key={`group-${group}`} className={styles.groupRow}>
                    <TableCell colSpan={5}>{GROUP_LABELS[group]}</TableCell>
                  </TableRow>,
                  ...inGroup.flatMap((category) => {
                    const server = availableById.get(category.id);
                    const spentCents = server?.spentCents ?? 0;
                    const releasedCents = server?.cashflowReleasedCents ?? 0;
                    const draft = parseIncomeToCents(drafts[category.id] ?? "");
                    const assignedNow = draft ?? assignments[category.id] ?? 0;
                    const availableNow =
                      assignedNow - spentCents + releasedCents;
                    const tone: DangerTone = classifySpendState(
                      spentCents,
                      assignedNow + releasedCents,
                    );
                    const proposal = proposals.find(
                      (p) => p.categoryId === category.id,
                    );
                    const applying = busyKey === `apply:${proposal?.id}`;
                    return [
                      <TableRow
                        key={category.id}
                        state={tone === "healthy" ? "none" : tone}
                      >
                        <TableCell>{category.name}</TableCell>
                        <TableCell>
                          <form
                            className={styles.assignForm}
                            onSubmit={(event) => {
                              event.preventDefault();
                              void handleAssign(category.id);
                            }}
                          >
                            <input
                              aria-label={`Assign ${category.name}`}
                              className={styles.assignInput}
                              inputMode="decimal"
                              placeholder="0.00"
                              value={drafts[category.id] ?? ""}
                              onChange={(event) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [category.id]: event.target.value,
                                }))
                              }
                            />
                            <Button
                              type="submit"
                              size="sm"
                              variant="secondary"
                              disabled={busyKey !== null}
                            >
                              {busyKey === `assign:${category.id}`
                                ? "Assigning…"
                                : "Assign"}
                            </Button>
                          </form>
                        </TableCell>
                        <TableCell>{formatCents(spentCents)}</TableCell>
                        <TableCell>{formatCents(availableNow)}</TableCell>
                        <TableCell>
                          {tone === "overspent" ? (
                            <Badge tone="overspent">Overspent</Badge>
                          ) : null}
                        </TableCell>
                      </TableRow>,
                      ...(proposal
                        ? [
                            // Advisor-proposed rows are display-only until
                            // Apply: distinct tint, labeled suggestion, and
                            // the only button that can mutate the ledger.
                            <TableRow
                              key={`proposal-${proposal.id}`}
                              className={styles.proposalRow}
                            >
                              <TableCell colSpan={5}>
                                <div className={styles.proposal}>
                                  <Badge tone="info">Proposed</Badge>
                                  <span>
                                    {proposal.reason ?? "Advisor suggestion"}
                                  </span>
                                  <span className="muted">
                                    Assign{" "}
                                    {formatCents(proposal.suggestedCents)}
                                  </span>
                                  <Button
                                    size="sm"
                                    onClick={() => void handleApply(proposal)}
                                    disabled={busyKey !== null}
                                  >
                                    {applying ? "Applying…" : "Apply proposal"}
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>,
                          ]
                        : []),
                    ];
                  }),
                ];
              })}
            </TableBody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
}
