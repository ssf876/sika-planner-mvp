"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyProposalAction,
  assignCategoryAction,
  copyPreviousMonthAction,
  type PlannerActionResult,
} from "@/app/actions/planner";
import { Button } from "@/components/ui/Button";
import { classifySpendState } from "@/components/ui/danger-state";
import { parseIncomeToCents } from "@/lib/auth/validate";
import { formatCents } from "@/lib/money";
import type { PlannerProposal } from "@/lib/planner/proposals";
import type { WindfallContext } from "@/lib/repositories/windfall";
import type { CategoryAvailable, CategoryGroup } from "@/src/engine";

import { getCompletionState } from "./completion-state";
import { PlannedAmountCell } from "./planned-amount";
import { WindfallBanner } from "./windfall-banner";

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
  /** D13 advisor surface — omitted when the household has no month context. */
  windfall?: WindfallContext | null;
}

/** Plain-dollars text for the inline editor; blank for unassigned rows. */
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
 * The v1.1 monthly planner: a Ready-to-Assign hero over open category-group
 * sections with directly editable planned values (the existing assignment
 * action stays the only writer), semantic healthy/watch/overspent rows, and
 * Sika recommendation cards that mutate nothing until Apply.
 */
export function PlannerView({
  monthId,
  incomeReceivedCents,
  hasPreviousMonth,
  categories,
  initialAvailability,
  proposals: initialProposals,
  windfall,
}: PlannerViewProps) {
  const [assignments, setAssignments] = useState(() =>
    assignmentsOf(initialAvailability),
  );
  const [availability, setAvailability] = useState(initialAvailability);
  const [drafts, setDrafts] = useState(() => draftsOf(initialAvailability));
  const [proposals, setProposals] = useState(initialProposals);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Inline-edit state: which value is open, per-row validation, and the
  // brief post-save confirmation.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [validation, setValidation] = useState<Record<string, string | null>>(
    {},
  );
  const [savedId, setSavedId] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);

  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  /** Set when an editor closes; the row's affordance gets focus back. */
  const pendingFocusRef = useRef<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The editor mounts with editingId — focus is handled inside
  // PlannedAmountCell. When it closes, the freshly mounted affordance takes
  // focus back (focusing the ref before remount would hit a detached node).
  useEffect(() => {
    if (editingId) return;
    if (pendingFocusRef.current) {
      const categoryId = pendingFocusRef.current;
      pendingFocusRef.current = null;
      editButtonRefs.current.get(categoryId)?.focus();
    }
  }, [editingId]);

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
    },
    [],
  );

  // The zero-based target: income received minus what the plan assigns,
  // including unsaved drafts so the indicator moves as you type.
  const readyToAssignCents = useMemo(() => {
    const assigned = categories.reduce((sum, category) => {
      const raw = drafts[category.id] ?? "";
      // A cleared field means the money is back in Ready to Assign; garbage
      // input falls back to the last saved assignment so RTA never jumps.
      if (raw.trim() === "") return sum;
      const draft = parseIncomeToCents(raw);
      return sum + (draft ?? assignments[category.id] ?? 0);
    }, 0);
    return incomeReceivedCents - assigned;
  }, [categories, drafts, assignments, incomeReceivedCents]);

  // The balanced "Every dollar assigned" state is an achievement: it only
  // applies once income has actually arrived. A fresh zero/zero month gets
  // the "nothing to assign yet" invitation instead.
  const completion = getCompletionState(
    incomeReceivedCents,
    readyToAssignCents,
  );

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

  function setDraft(categoryId: string, value: string) {
    setDrafts((prev) => ({ ...prev, [categoryId]: value }));
  }

  function closeEditor(categoryId: string) {
    pendingFocusRef.current = categoryId;
    setEditingId((prev) => (prev === categoryId ? null : prev));
  }

  function cancelEdit(categoryId: string) {
    setDrafts((prev) => ({
      ...prev,
      [categoryId]: formatCentsForInput(assignments[categoryId] ?? 0),
    }));
    setValidation((prev) => ({ ...prev, [categoryId]: null }));
    closeEditor(categoryId);
  }

  async function commitEdit(categoryId: string) {
    if (editingId !== categoryId) return;
    const draft = drafts[categoryId] ?? "";
    const cents = parseIncomeToCents(draft);

    // Invalid drafts keep their text and show validation — the user
    // corrects rather than re-types.
    if (cents === null) {
      setValidation((prev) => ({
        ...prev,
        [categoryId]: "Enter a valid dollar amount.",
      }));
      return;
    }

    // No-op save: close quietly.
    if (cents === (assignments[categoryId] ?? 0)) {
      setValidation((prev) => ({ ...prev, [categoryId]: null }));
      closeEditor(categoryId);
      return;
    }

    setError(null);
    setBusyKey(`assign:${categoryId}`);
    try {
      const result: PlannerActionResult = await assignCategoryAction(
        monthId,
        categoryId,
        draft.trim(),
      );
      if (!result.ok || !result.availability) {
        // Server rejection keeps the editor open with the reason — the
        // draft is intact for a retry, and RTA never jumped.
        setValidation((prev) => ({
          ...prev,
          [categoryId]:
            result.error ?? "That assignment didn't save — try again.",
        }));
        return;
      }
      syncFromServer(result.availability);
      setValidation((prev) => ({ ...prev, [categoryId]: null }));
      closeEditor(categoryId);
      setSavedId(categoryId);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedId(null), 1400);
    } catch (caught) {
      console.error("planner: assign failed", caught);
      setValidation((prev) => ({ ...prev, [categoryId]: TRANSPORT_ERROR }));
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
      // Brief "Applied" beat on the card, then the suggestion collapses.
      setAppliedId(proposal.id);
      if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
      appliedTimerRef.current = setTimeout(() => {
        setProposals((prev) => prev.filter((p) => p.id !== proposal.id));
        setAppliedId(null);
      }, 1400);
    } catch (caught) {
      console.error("planner: apply failed", caught);
      setError(TRANSPORT_ERROR);
    } finally {
      setBusyKey(null);
    }
  }

  function handleDismiss(proposalId: string) {
    setProposals((prev) => prev.filter((p) => p.id !== proposalId));
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
    <div className={styles.planner}>
      {windfall ? (
        <WindfallBanner
          monthId={windfall.monthId}
          incomeRows={windfall.incomeRows}
          detection={windfall.detection}
          expectedIncomeCents={windfall.expectedIncomeCents}
          rankContext={windfall.rankContext}
          onAvailabilitySync={syncFromServer}
        />
      ) : null}

      <section aria-label="Ready to assign" className={styles.summary} aria-live="polite">
        <span className={styles.summaryLabel}>Ready to assign</span>
        <strong
          className={styles.summaryAmount}
          data-negative={readyToAssignCents < 0 ? "true" : undefined}
          data-testid="ready-to-assign"
        >
          {formatCents(readyToAssignCents)}
        </strong>
        {savedId ? (
          <span className={styles.savedNote} role="status">
            Saved
          </span>
        ) : null}
        {completion.message ? (
          <p
            className={styles.completionMessage}
            data-kind={completion.kind}
          >
            {completion.message}
          </p>
        ) : null}
      </section>

      <div className={styles.copyRow}>
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

      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}

      <div className={styles.groups}>
        {GROUP_ORDER.flatMap((group) => {
          const inGroup = categories.filter((c) => c.group === group);
          if (inGroup.length === 0) return [];
          const groupPlanned = inGroup.reduce((sum, category) => {
            const draft = parseIncomeToCents(drafts[category.id] ?? "");
            return (
              sum + (draft ?? assignments[category.id] ?? 0)
            );
          }, 0);
          return [
            <section
              key={`group-${group}`}
              aria-label={GROUP_LABELS[group]}
              className={styles.group}
            >
              <h2 className={styles.groupName}>{GROUP_LABELS[group]}</h2>
              <span className={styles.groupTotal}>
                {formatCents(groupPlanned)} planned
              </span>
              <ul className={styles.rows}>
                {inGroup.map((category) => {
                  const server = availableById.get(category.id);
                  const spentCents = server?.spentCents ?? 0;
                  const releasedCents = server?.cashflowReleasedCents ?? 0;
                  const draft = parseIncomeToCents(drafts[category.id] ?? "");
                  const assignedNow = draft ?? assignments[category.id] ?? 0;
                  const availableNow =
                    assignedNow - spentCents + releasedCents;
                  const state = classifySpendState(
                    spentCents,
                    assignedNow + releasedCents,
                  );
                  const saving = busyKey !== null;
                  return (
                    <li
                      key={category.id}
                      className={styles.row}
                      data-state={state}
                    >
                      <span className={styles.categoryName}>
                        {category.name}
                      </span>
                      <span className={styles.plannedCell}>
                        <PlannedAmountCell
                          categoryId={category.id}
                          categoryName={category.name}
                          plannedCents={assignedNow}
                          spentCents={spentCents}
                          editing={editingId === category.id}
                          saving={saving}
                          validationId={`planned-validation-${category.id}`}
                          validation={validation[category.id] ?? null}
                          draft={drafts[category.id] ?? ""}
                          onEdit={setEditingId}
                          onDraftChange={setDraft}
                          onCommit={(id) => void commitEdit(id)}
                          onCancel={cancelEdit}
                          registerRef={(id, node) => {
                            if (node) {
                              editButtonRefs.current.set(id, node);
                            } else {
                              editButtonRefs.current.delete(id);
                            }
                          }}
                        />
                      </span>
                      <span className={styles.spentCell}>
                        <span className={styles.valueLabel}>Spent</span>
                        <span className={styles.value}>
                          {formatCents(spentCents)}
                        </span>
                      </span>
                      <span className={styles.leftCell}>
                        <span className={styles.valueLabel}>Left</span>
                        <span
                          className={styles.value}
                          data-negative={availableNow < 0 ? "true" : undefined}
                        >
                          {formatCents(availableNow)}
                        </span>
                      </span>
                      <span className={styles.status} data-tone={state}>
                        {state === "overspent"
                          ? "Overspent"
                          : state === "watch"
                            ? "Watch"
                            : "On track"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>,
          ];
        })}
      </div>

      {proposals.length > 0 ? (
        <section
          aria-label="Sika recommendations"
          data-testid="recommendations"
          className={styles.recommendations}
        >
          {proposals.map((proposal) => {
            const category = categories.find(
              (c) => c.id === proposal.categoryId,
            );
            const categoryName = category?.name ?? "this category";
            const currentCents = assignments[proposal.categoryId] ?? 0;
            const applied = appliedId === proposal.id;
            const applying = busyKey === `apply:${proposal.id}`;
            const rtaAfter =
              readyToAssignCents - proposal.suggestedCents + currentCents;
            return (
              <article
                key={proposal.id}
                data-testid={`proposal-${proposal.id}`}
                className={styles.recommendationCard}
              >
                <p className={styles.recommendationHeading}>
                  What Sika noticed
                </p>
                {applied ? (
                  <p className={styles.appliedNote} data-visible="true" role="status">
                    Applied — {formatCents(proposal.suggestedCents)} to{" "}
                    {categoryName}.
                  </p>
                ) : (
                  <>
                    <p className={styles.recommendationNotice}>
                      {proposal.reason ?? "Advisor suggestion"}
                    </p>
                    <p className={styles.recommendationExplainer}>
                      Suggests {formatCents(proposal.suggestedCents)} to{" "}
                      {categoryName}. {categoryName} goes from{" "}
                      {formatCents(currentCents)} to{" "}
                      {formatCents(proposal.suggestedCents)} planned. Ready to
                      assign moves to {formatCents(rtaAfter)}.
                    </p>
                    <div className={styles.proposalActions}>
                      <button
                        type="button"
                        className={styles.proposalApply}
                        onClick={() => void handleApply(proposal)}
                        disabled={busyKey !== null}
                      >
                        {applying ? "Applying…" : "Apply"}
                      </button>
                      <button
                        type="button"
                        className={styles.proposalDismiss}
                        onClick={() => handleDismiss(proposal.id)}
                        disabled={busyKey !== null}
                      >
                        Not now
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
