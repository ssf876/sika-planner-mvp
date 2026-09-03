"use client";

import { useActionState } from "react";

import {
  loginAction,
  signupAction,
  type AuthFormState,
} from "@/app/actions/auth";

const initialState: AuthFormState = { error: null };

export function AuthForm({ mode }: { mode: "signup" | "login" }) {
  const [state, formAction, pending] = useActionState(
    mode === "signup" ? signupAction : loginAction,
    initialState,
  );

  return (
    <form action={formAction} className="card stack">
      {state.error ? (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      ) : null}

      <label className="field">
        <span>Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
      </label>

      <label className="field">
        <span>Password</span>
        <input
          type="password"
          name="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={mode === "signup" ? 8 : undefined}
          placeholder={
            mode === "signup" ? "At least 8 characters" : "Your password"
          }
        />
      </label>

      <button type="submit" disabled={pending}>
        {pending ? "Working…" : mode === "signup" ? "Create account" : "Log in"}
      </button>
    </form>
  );
}
