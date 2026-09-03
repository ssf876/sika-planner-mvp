"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  createGoalAction,
  toggleGoalAction,
  updateGoalAction,
  type GoalFormState,
} from "@/app/actions/funds";
import { Badge, Button, Input } from "@/components/ui";
import type { GoalRow } from "@/lib/repositories/goals";
import { formatCents } from "@/lib/money";

const initialState: GoalFormState = { error: null, ok: false };

const GOAL_KINDS = [
  { value: "PAYOFF_DEBT", label: "Payoff debt faster" },
  { value: "GROW_NET_WORTH", label: "Increase net worth" },
  { value: "CUSTOM", label: "Something else" },
] as const;

const kindLabel = (kind: string): string =>
  GOAL_KINDS.find((k) => k.value === kind)?.label ?? kind;

/** Resets itself after a successful save (fresh state object per submission). */
function useResetOnSuccess(ok: boolean) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (ok) formRef.current?.reset();
  }, [ok]);
  return formRef;
}

function GoalCreateForm() {
  const [state, formAction, pending] = useActionState(
    createGoalAction,
    initialState,
  );
  const formRef = useResetOnSuccess(state.ok);

  return (
    <form ref={formRef} action={formAction} className="stack">
      <h3>New goal</h3>
      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="form-success">
          Goal created.
        </p>
      ) : null}

      <label className="field">
        <span>What kind of goal?</span>
        <select name="kind" required defaultValue="PAYOFF_DEBT">
          {GOAL_KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </label>

      <Input label="Goal name" name="name" placeholder="Emergency fund" required />

      <Input
        label="Target amount (optional)"
        name="targetAmount"
        inputMode="decimal"
        placeholder="5,000"
      />

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create goal"}
      </Button>
    </form>
  );
}

function GoalEditForm({ goal }: { goal: GoalRow }) {
  const [state, formAction, pending] = useActionState(
    updateGoalAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  // Keep entered values while editing; reset only after a successful save.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="stack">
      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="form-success">
          Goal updated.
        </p>
      ) : null}
      <input type="hidden" name="goalId" value={goal.id} />

      <label className="field">
        <span>What kind of goal?</span>
        <select name="kind" required defaultValue={goal.kind}>
          {GOAL_KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </label>

      <Input
        label="Goal name"
        name="name"
        placeholder="Emergency fund"
        defaultValue={goal.name}
        required
      />

      <Input
        label="Target amount (optional)"
        name="targetAmount"
        inputMode="decimal"
        defaultValue={goal.targetCents != null ? String(goal.targetCents / 100) : ""}
      />

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save goal"}
      </Button>
    </form>
  );
}

/**
 * Goals are the advisor's ranking data (spec): creating, editing, and
 * retiring them reshapes windfall proposals immediately.
 */
export function GoalsPanel({ goals }: { goals: GoalRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <section className="card stack" aria-label="Goals">
      <h2>Goals</h2>
      <GoalCreateForm />

      {goals.length === 0 ? (
        <p className="muted">
          No goals yet — your first goal shapes how unplanned income gets
          ranked.
        </p>
      ) : (
        <ul className="goal-list">
          {goals.map((goal) => (
            <li key={goal.id} className="goal-row">
              <div className="goal-summary">
                <div className="fund-header">
                  <strong>{goal.name}</strong>
                  <Badge tone={goal.active ? "info" : "neutral"}>
                    {goal.active ? "Active" : "Retired"}
                  </Badge>
                </div>
                <span className="muted">
                  {kindLabel(goal.kind)}
                  {goal.targetCents != null
                    ? ` · target ${formatCents(goal.targetCents)}`
                    : ""}
                </span>
                <div className="goal-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setEditingId((current) =>
                        current === goal.id ? null : goal.id,
                      )
                    }
                    aria-expanded={editingId === goal.id}
                  >
                    {editingId === goal.id ? "Close editor" : "Edit"}
                  </Button>
                  <ToggleForm goal={goal} />
                </div>
              </div>
              {editingId === goal.id ? <GoalEditForm goal={goal} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ToggleForm({ goal }: { goal: GoalRow }) {
  const [state, formAction, pending] = useActionState(
    toggleGoalAction,
    initialState,
  );

  return (
    <form action={formAction}>
      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}
      <input type="hidden" name="goalId" value={goal.id} />
      <input type="hidden" name="active" value={goal.active ? "false" : "true"} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Updating…" : goal.active ? "Retire" : "Reactivate"}
      </Button>
    </form>
  );
}
