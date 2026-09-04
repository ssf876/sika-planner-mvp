"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";

import {
  createAccountAction,
  type AccountFormState,
} from "@/app/actions/accounts";
import {
  ACCOUNT_KIND_LABELS,
  ONBOARDING_ACCOUNT_KINDS,
  accountKindFrom,
} from "@/lib/accounts/form";

const initialState: AccountFormState = { error: null, ok: false };

interface CreatedAccount {
  name: string;
  kindLabel: string;
}

/**
 * First-run account setup (v1.1 PR 4): the one place a brand-new household can
 * create an account. Each successful submission wires the existing
 * createAccountAction path; the form stays for "add another" until the user
 * heads to the dashboard.
 */
export function AccountSetupForm() {
  const [state, formAction, pending] = useActionState(submit, initialState);
  const [created, setCreated] = useState<CreatedAccount[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  // Client-side wrapper around the server action: on success, record what was
  // created for the running list and clear the form for the next entry.
  async function submit(
    prev: AccountFormState,
    formData: FormData,
  ): Promise<AccountFormState> {
    const result = await createAccountAction(prev, formData);
    if (!result.ok) return result;

    const name = String(formData.get("name") ?? "").trim();
    const kind = accountKindFrom(String(formData.get("kind") ?? ""));
    const kindLabel = kind ? ACCOUNT_KIND_LABELS[kind] : "Account";
    setCreated((list) => [...list, { name, kindLabel }]);
    formRef.current?.reset();
    return result;
  }

  return (
    <div className="stack">
      <form ref={formRef} action={formAction} className="card stack">
        {state.error ? (
          <p role="alert" className="form-error">
            {state.error}
          </p>
        ) : null}

        <fieldset>
          <legend>What kind of account is it?</legend>
          {ONBOARDING_ACCOUNT_KINDS.map((kind) => (
            <label key={kind} className="choice">
              <input type="radio" name="kind" value={kind} required />
              <span>{ACCOUNT_KIND_LABELS[kind]}</span>
            </label>
          ))}
        </fieldset>

        <label className="field">
          <span>Account name</span>
          <input
            type="text"
            name="name"
            required
            placeholder="Everyday Checking"
          />
        </label>

        <label className="field">
          <span>Starting balance</span>
          <input
            type="text"
            name="startingBalance"
            inputMode="decimal"
            placeholder="Optional — e.g. 1,200"
          />
        </label>

        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </button>
      </form>

      {created.length > 0 ? (
        <div className="stack" data-testid="created-accounts">
          <p role="status" className="form-success">
            Created {created[created.length - 1]?.name}.
          </p>
          <ul className="created-list">
            {created.map((account, index) => (
              <li key={`${account.name}-${index}`}>
                {account.name} · {account.kindLabel}
              </li>
            ))}
          </ul>
          <div>
            <Link href="/dashboard" className="button-link">
              Go to your dashboard
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
