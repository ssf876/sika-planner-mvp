"use client";

import { useActionState } from "react";

import {
  recordTransferAction,
  type TransactionFormState,
} from "@/app/actions/transactions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

import type { EntryAccount } from "./entry-form";

const initialState: TransactionFormState = { error: null, ok: false };

/**
 * Move money between two of the household's accounts — card payments, ATM
 * withdrawals, settling a goal. Zero categories, zero month cashflow: the
 * engine enforces it, the form just stays out of the way.
 */
export function TransferForm({
  accounts,
  today,
}: {
  accounts: EntryAccount[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    recordTransferAction,
    initialState,
  );

  return (
    <form action={formAction} className="stack">
      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="form-success">
          Transfer recorded.
        </p>
      ) : null}

      <label className="field">
        <span>From</span>
        <select name="fromAccountId" required defaultValue="">
          <option value="" disabled>
            Move money from…
          </option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>To</span>
        <select name="toAccountId" required defaultValue="">
          <option value="" disabled>
            Move money to…
          </option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>

      <Input
        label="Amount"
        name="amount"
        inputMode="decimal"
        placeholder="100.00"
        hint="Moves between accounts — this is never spending."
        required
      />

      <Input
        label="Date"
        name="date"
        type="date"
        defaultValue={today}
        required
      />

      <Input label="Note (optional)" name="payee" placeholder="Card payment" />

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Moving…" : "Record transfer"}
      </Button>
    </form>
  );
}
