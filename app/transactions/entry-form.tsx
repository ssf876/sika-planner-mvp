"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  recordTransactionAction,
  type TransactionFormState,
} from "@/app/actions/transactions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { CategoryGroup } from "@prisma/client";

const initialState: TransactionFormState = { error: null, ok: false };

export interface EntryCategory {
  id: string;
  name: string;
  group: CategoryGroup;
}

export interface EntryAccount {
  id: string;
  name: string;
}

const GROUP_LABELS: Record<CategoryGroup, string> = {
  NEEDS: "Needs",
  WANTS: "Wants",
  SAVINGS_DEBTS: "Savings & Debts",
  INVESTMENTS: "Investments",
};

/**
 * Manual transaction entry (D4). The user picks the category as they type, so
 * successful entries land CONFIRMED unless the review-queue box is ticked.
 */
export function TransactionEntryForm({
  accounts,
  categories,
  today,
}: {
  accounts: EntryAccount[];
  categories: EntryCategory[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    recordTransactionAction,
    initialState,
  );
  const [kind, setKind] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const formRef = useRef<HTMLFormElement>(null);

  // Reset for the next entry after a successful save (the action returns a
  // fresh state object per submission, so this fires once per save).
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setKind("EXPENSE");
    }
  }, [state]);

  const groups = Object.keys(GROUP_LABELS) as CategoryGroup[];

  return (
    <form ref={formRef} action={formAction} className="stack">
      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="form-success">
          Transaction recorded.
        </p>
      ) : null}

      <label className="field">
        <span>Account</span>
        <select name="accountId" required defaultValue="">
          <option value="" disabled>
            Choose an account…
          </option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="field">
        <legend>Type</legend>
        <label className="radio">
          <input
            type="radio"
            name="kind"
            value="EXPENSE"
            checked={kind === "EXPENSE"}
            onChange={() => setKind("EXPENSE")}
          />{" "}
          Expense
        </label>
        <label className="radio">
          <input
            type="radio"
            name="kind"
            value="INCOME"
            checked={kind === "INCOME"}
            onChange={() => setKind("INCOME")}
          />{" "}
          Income
        </label>
      </fieldset>

      <Input
        label="Amount"
        name="amount"
        inputMode="decimal"
        placeholder="24.50"
        hint="Dollars and cents — the type of entry decides the direction."
        required
      />

      <Input label="Payee" name="payee" placeholder="Corner Grocer" required />

      <Input
        label="Date"
        name="date"
        type="date"
        defaultValue={today}
        required
      />

      {kind === "EXPENSE" ? (
        <label className="field">
          <span>Category</span>
          <select name="categoryId" required defaultValue="">
            <option value="" disabled>
              What is this spending for?
            </option>
            {groups.map((group) => {
              const inGroup = categories.filter((c) => c.group === group);
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
        </label>
      ) : null}

      <label className="field checkbox">
        <input type="checkbox" name="pending" /> Pending — not yet settled by
        the bank
      </label>
      <label className="field checkbox">
        <input type="checkbox" name="needsReview" /> Needs review — check the
        category later
      </label>

      <Input label="Note (optional)" name="note" placeholder="Weekly shop" />

      <Button type="submit" disabled={pending}>
        {pending ? "Recording…" : "Record transaction"}
      </Button>
    </form>
  );
}
