"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  contributeFundAction,
  createFundAction,
  recordFundDrawAction,
  recordStaticDrawAction,
  type FundFormState,
} from "@/app/actions/funds";
import { Badge, Button, Input } from "@/components/ui";
import type { FundBoardEntry, FundBoardMonth } from "@/lib/repositories/funds";
import { formatCents } from "@/lib/money";

const initialState: FundFormState = { error: null, ok: false };

export interface BoardAccount {
  id: string;
  name: string;
}

export interface BoardCategory {
  id: string;
  name: string;
}

/** Resets itself after a successful save (fresh state object per submission). */
function useResetOnSuccess(ok: boolean) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (ok) formRef.current?.reset();
  }, [ok]);
  return formRef;
}

// ─── This-month cashflow strip ───────────────────────────────────────────────

/**
 * The month's cashflow with "Popped up" called out by name — fund draws are
 * cashflow for the month, never paycheck income (spec, money semantics).
 */
export function MonthCashflowCard({ month }: { month: FundBoardMonth }) {
  return (
    <section className="card" aria-label="This month">
      <h2>{month.label} cashflow</h2>
      <div className="month-strip">
        <div>
          <span>Income received</span>
          <strong>{formatCents(month.incomeReceivedCents)}</strong>
        </div>
        <div>
          <span>Popped up</span>
          <strong>{formatCents(month.fundDrawCents)}</strong>
        </div>
        <div>
          <span>Spending</span>
          <strong>{formatCents(month.spendingCents)}</strong>
        </div>
        <div>
          <span>Net</span>
          <strong>{formatCents(month.netCashflowCents)}</strong>
        </div>
      </div>
      <p className="muted">
        Popped up = fund draws released this month — cashflow, never extra
        paycheck income.
      </p>
    </section>
  );
}

// ─── Create a fund ───────────────────────────────────────────────────────────

function FundCreateForm({ categories }: { categories: BoardCategory[] }) {
  const [state, formAction, pending] = useActionState(
    createFundAction,
    initialState,
  );
  const [kind, setKind] = useState<"SINKING" | "STATIC">("SINKING");
  const formRef = useResetOnSuccess(state.ok);

  return (
    <form ref={formRef} action={formAction} className="stack">
      <h3>Create a fund</h3>
      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="form-success">
          Fund created.
        </p>
      ) : null}

      <fieldset className="field">
        <legend>Type</legend>
        <label className="radio">
          <input
            type="radio"
            name="kind"
            value="SINKING"
            checked={kind === "SINKING"}
            onChange={() => setKind("SINKING")}
          />{" "}
          Sinking fund — saves up for pop-ups and pays them
        </label>
        <label className="radio">
          <input
            type="radio"
            name="kind"
            value="STATIC"
            checked={kind === "STATIC"}
            onChange={() => setKind("STATIC")}
          />{" "}
          Static goal — holds until drawn from
        </label>
      </fieldset>

      <Input label="Fund name" name="name" placeholder="Car repairs" required />

      <Input
        label="Target amount (optional)"
        name="targetAmount"
        inputMode="decimal"
        placeholder="1,200"
      />

      <Input label="Target date (optional)" name="targetDate" type="date" />

      <label className="field">
        <span>Backed by category (optional)</span>
        <select name="companionCategoryId" defaultValue="">
          <option value="">
            {kind === "SINKING"
              ? "Create a matching category for me"
              : "No category — draws stay uncoupled"}
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create fund"}
      </Button>
    </form>
  );
}

// ─── Per-fund actions ────────────────────────────────────────────────────────

function ContributeForm({ fundId }: { fundId: string }) {
  const [state, formAction, pending] = useActionState(
    contributeFundAction,
    initialState,
  );
  const formRef = useResetOnSuccess(state.ok);

  return (
    <form ref={formRef} action={formAction} className="stack">
      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="form-success">
          Contribution added.
        </p>
      ) : null}
      <input type="hidden" name="fundId" value={fundId} />
      <Input
        label="Contribution"
        name="amount"
        inputMode="decimal"
        placeholder="100"
        hint="Adds to the fund's balance."
        required
      />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add contribution"}
      </Button>
    </form>
  );
}

function SinkingDrawForm({
  fundId,
  accounts,
  today,
}: {
  fundId: string;
  accounts: BoardAccount[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    recordFundDrawAction,
    initialState,
  );
  const formRef = useResetOnSuccess(state.ok);

  if (accounts.length === 0) {
    return (
      <p className="muted">
        Add an account first — a pop-up expense needs an account to post from.
      </p>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="stack">
      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="form-success">
          Pop-up recorded — the fund paid, and the month shows it as popped up.
        </p>
      ) : null}
      <input type="hidden" name="fundId" value={fundId} />

      <label className="field">
        <span>Paid from</span>
        <select name="accountId" required defaultValue="">
          <option value="" disabled>
            Choose the account…
          </option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>

      <Input
        label="Pop-up cost"
        name="amount"
        inputMode="decimal"
        placeholder="240"
        required
      />
      <Input label="Paid to" name="payee" placeholder="Midwest Movers" required />
      <Input label="Date" name="date" type="date" defaultValue={today} required />
      <Input label="Note (optional)" name="note" placeholder="Brake job" />

      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Recording…" : "Record pop-up"}
      </Button>
    </form>
  );
}

function StaticDrawForm({
  fundId,
  today,
}: {
  fundId: string;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(
    recordStaticDrawAction,
    initialState,
  );
  const formRef = useResetOnSuccess(state.ok);

  return (
    <form ref={formRef} action={formAction} className="stack">
      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="form-success">
          Draw recorded — reported as popped up, never as income.
        </p>
      ) : null}
      <input type="hidden" name="fundId" value={fundId} />

      <Input
        label="Draw amount"
        name="amount"
        inputMode="decimal"
        placeholder="500"
        required
      />
      <Input label="Date" name="date" type="date" defaultValue={today} required />

      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? "Drawing…" : "Draw from goal"}
      </Button>
    </form>
  );
}

export function FundCard({
  fund,
  accounts,
  today,
}: {
  fund: FundBoardEntry;
  accounts: BoardAccount[];
  today: string;
}) {
  return (
    <section className="card" aria-label={`Fund ${fund.name}`}>
      <div className="fund-header">
        <h3>{fund.name}</h3>
        <Badge tone={fund.kind === "SINKING" ? "info" : "neutral"}>
          {fund.kind === "SINKING" ? "Sinking fund" : "Static goal"}
        </Badge>
      </div>

      <p className="fund-balance">
        {formatCents(fund.balanceCents)}
        {fund.targetCents != null
          ? ` toward ${formatCents(fund.targetCents)}`
          : " saved"}
      </p>
      {fund.targetCents != null && fund.targetDate ? (
        <p className="muted">
          Target date {fund.targetDate}
        </p>
      ) : null}
      {fund.companionCategory ? (
        <p className="muted">Pays pop-ups against “{fund.companionCategory.name}”.</p>
      ) : null}

      <ContributeForm fundId={fund.id} />

      {fund.kind === "SINKING" ? (
        <SinkingDrawForm fundId={fund.id} accounts={accounts} today={today} />
      ) : (
        <StaticDrawForm fundId={fund.id} today={today} />
      )}

      {fund.draws.length > 0 ? (
        <div>
          <h4>Draw history</h4>
          <ul className="draw-list">
            {fund.draws.map((draw) => (
              <li key={draw.id}>
                <strong>Popped up {formatCents(draw.amountCents)}</strong> —{" "}
                {draw.monthLabel}
                {draw.paidExpense && draw.expensePayee
                  ? ` · paid ${draw.expensePayee}`
                  : " · goal draw"}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted">No draws yet.</p>
      )}
    </section>
  );
}

// ─── The board ───────────────────────────────────────────────────────────────

export function FundsBoard({
  funds,
  month,
  accounts,
  categories,
  today,
}: {
  funds: FundBoardEntry[];
  month: FundBoardMonth;
  accounts: BoardAccount[];
  /** Fund-less categories a new fund can back. */
  categories: BoardCategory[];
  today: string;
}) {
  return (
    <div className="stack">
      <MonthCashflowCard month={month} />

      <section className="card">
        <FundCreateForm categories={categories} />
      </section>

      {funds.length === 0 ? (
        <section className="card">
          <h2>No funds yet</h2>
          <p className="muted">
            Create a sinking fund above for pop-ups you can see coming (car
            repairs, holidays) — it pays the bill when the item pops up. Choose
            a static goal for money that stays put until you explicitly draw
            from it.
          </p>
        </section>
      ) : (
        funds.map((fund) => (
          <FundCard
            key={fund.id}
            fund={fund}
            accounts={accounts}
            today={today}
          />
        ))
      )}
    </div>
  );
}
