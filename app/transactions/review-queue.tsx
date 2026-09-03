"use client";

import { useActionState } from "react";

import {
  confirmReviewAction,
  setAutoAcceptAction,
} from "@/app/actions/categorizer";
import { initialReviewQueueState } from "@/app/actions/categorizer-state";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/Table";
import { formatCents } from "@/lib/money";
import type { CategoryGroup } from "@prisma/client";

import type { ReviewQueueRow } from "@/lib/repositories/categorizer";
import { EXACT_MATCH_CONFIDENCE } from "@/src/categorizer";

const GROUP_LABELS: Record<CategoryGroup, string> = {
  NEEDS: "Needs",
  WANTS: "Wants",
  SAVINGS_DEBTS: "Savings & Debts",
  INVESTMENTS: "Investments",
};

export interface QueueCategory {
  id: string;
  name: string;
  group: CategoryGroup;
}

function suggestionBadge(row: ReviewQueueRow) {
  if (!row.suggestion) return <Badge tone="neutral">No suggestion</Badge>;
  const percent = Math.round(row.suggestion.confidence * 100);
  return (
    <Badge tone={row.suggestion.confidence === EXACT_MATCH_CONFIDENCE ? "info" : "neutral"}>
      {row.suggestion.confidence === EXACT_MATCH_CONFIDENCE
        ? "Exact match"
        : `${percent}% match`}
    </Badge>
  );
}

/**
 * The review queue (D5): NEEDS_REVIEW rows with the categorizer's
 * suggestion pre-filled. Submitting as-is confirms the suggestion;
 * picking another category first edits it. Either way the choice lands
 * in the confirmed stream and teaches the learner.
 */
export function ReviewQueue({
  rows,
  categories,
  autoAccept,
}: {
  rows: ReviewQueueRow[];
  categories: QueueCategory[];
  autoAccept: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    confirmReviewAction,
    initialReviewQueueState,
  );
  const groups = Object.keys(GROUP_LABELS) as CategoryGroup[];

  return (
    <div className="stack">
      <form action={setAutoAcceptAction}>
        <label className="field checkbox">
          <input
            type="checkbox"
            name="autoAccept"
            defaultChecked={autoAccept}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          />{" "}
          Auto-accept high-confidence suggestions when importing
        </label>
        <p className="hint">
          When on, an import categorizes rows it is certain about (exact payees
          you confirmed before) instead of queueing them. Everything else waits
          for you below. Off by default.
        </p>
      </form>

      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="form-success">
          Category confirmed.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="hint" role="status">
          Nothing to review. Imported rows land here when the categorizer has
          no confident suggestion.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Date</TableHeaderCell>
              <TableHeaderCell>Payee</TableHeaderCell>
              <TableHeaderCell>Account</TableHeaderCell>
              <TableHeaderCell>Amount</TableHeaderCell>
              <TableHeaderCell>Category</TableHeaderCell>
              <TableHeaderCell>Suggestion</TableHeaderCell>
              <TableHeaderCell>Confirm</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.date}</TableCell>
                <TableCell>
                  {row.payee}
                  {row.pending ? " (pending)" : ""}
                </TableCell>
                <TableCell>{row.accountName}</TableCell>
                <TableCell>{formatCents(row.amountCents)}</TableCell>
                <TableCell colSpan={2}>
                  <form action={formAction} id={`review-${row.id}`}>
                    <input type="hidden" name="transactionId" value={row.id} />
                    {row.kind === "EXPENSE" ? (
                      <select
                        name="categoryId"
                        defaultValue={row.suggestion?.categoryId ?? ""}
                        aria-label={`Category for ${row.payee}`}
                        required
                      >
                        <option value="" disabled>
                          What is this spending for?
                        </option>
                        {groups.map((group) => {
                          const inGroup = categories.filter(
                            (category) => category.group === group,
                          );
                          if (inGroup.length === 0) return null;
                          return (
                            <optgroup key={group} label={GROUP_LABELS[group]}>
                              {inGroup.map((category) => (
                                <option key={category.id} value={category.id}>
                                  {category.name}
                                </option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </select>
                    ) : (
                      <span>Ready to Assign</span>
                    )}
                    {suggestionBadge(row)}
                    <Button type="submit" size="sm" disabled={pending}>
                      Confirm
                    </Button>
                  </form>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
