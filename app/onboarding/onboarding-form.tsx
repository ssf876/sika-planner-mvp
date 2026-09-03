"use client";

import { useActionState } from "react";

import {
  onboardAction,
  type OnboardingFormState,
} from "@/app/actions/onboarding";
import {
  GOAL_LABELS,
  HOUSEHOLD_SIZE_LABELS,
  type HouseholdSize,
} from "@/lib/onboarding/seed";

const initialState: OnboardingFormState = { error: null };

const HOUSEHOLD_SIZES = Object.entries(HOUSEHOLD_SIZE_LABELS) as [
  HouseholdSize,
  string,
][];

type TopGoal = "PAYOFF_DEBT" | "GROW_NET_WORTH";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(
    onboardAction,
    initialState,
  );

  return (
    <form action={formAction} className="card stack">
      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}

      <fieldset>
        <legend>What is your top money goal today?</legend>
        {(Object.entries(GOAL_LABELS) as [TopGoal, string][]).map(
          ([value, label]) => (
            <label key={value} className="choice">
              <input type="radio" name="topGoal" value={value} required />
              <span>{label}</span>
            </label>
          ),
        )}
      </fieldset>

      <label className="field">
        <span>How much do you make per month?</span>
        <input
          type="text"
          name="monthlyIncome"
          inputMode="decimal"
          required
          placeholder="5,000"
        />
      </label>

      <fieldset>
        <legend>Who will be using the app?</legend>
        {HOUSEHOLD_SIZES.map(([value, label]) => (
          <label key={value} className="choice">
            <input type="radio" name="householdSize" value={value} required />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      <button type="submit" disabled={pending}>
        {pending ? "Building your budget…" : "Start budgeting"}
      </button>
    </form>
  );
}
