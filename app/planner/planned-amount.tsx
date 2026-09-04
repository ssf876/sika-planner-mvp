"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import styles from "./planner.module.css";

import { formatCents } from "@/lib/money";

/**
 * The planned value IS the affordance: the amount renders as a button;
 * activating it (click, Enter on focus, or touch) swaps in an inline
 * editor. Enter or blur saves, Escape cancels. The button stays in the
 * tab order so keyboard and touch users can always discover the edit —
 * hover only reveals a visual cue on pointer devices.
 */
export function PlannedAmountCell({
  categoryId,
  categoryName,
  plannedCents,
  spentCents,
  editing,
  saving,
  validationId,
  validation,
  draft,
  onEdit,
  onDraftChange,
  onCommit,
  onCancel,
  registerRef,
}: {
  categoryId: string;
  categoryName: string;
  plannedCents: number;
  spentCents: number;
  editing: boolean;
  saving: boolean;
  validationId: string;
  validation: string | null;
  draft: string;
  onEdit: (categoryId: string) => void;
  onDraftChange: (categoryId: string, value: string) => void;
  onCommit: (categoryId: string) => void;
  onCancel: (categoryId: string) => void;
  registerRef: (categoryId: string, node: HTMLButtonElement | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const overspent = spentCents > plannedCents;

  useEffect(() => {
    if (editing) {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    }
  }, [editing]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit(categoryId);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel(categoryId);
    }
  }

  if (editing) {
    return (
      <span className={styles.editorWrap}>
        <input
          ref={inputRef}
          className={styles.editorInput}
          aria-label={`Planned amount for ${categoryName}`}
          aria-invalid={validation ? true : undefined}
          aria-describedby={validation ? validationId : undefined}
          aria-disabled={saving}
          value={draft}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.00"
          disabled={saving}
          onChange={(event) => onDraftChange(categoryId, event.target.value)}
          onBlur={() => onCommit(categoryId)}
          onKeyDown={handleKeyDown}
        />
        {validation ? (
          <span id={validationId} role="alert" className={styles.validation}>
            {validation}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <button
      ref={(node) => registerRef(categoryId, node)}
      type="button"
      className={styles.plannedButton}
      disabled={saving}
      aria-label={`Edit planned amount for ${categoryName}`}
      onClick={() => onEdit(categoryId)}
    >
      <span className={styles.plannedValue}>{formatCents(plannedCents)}</span>
      <span aria-hidden="true" className={styles.editCue}>
        Edit
      </span>
      {overspent ? (
        <span className={styles.visuallyHidden}>(overspent)</span>
      ) : null}
    </button>
  );
}
