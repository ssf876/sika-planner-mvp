import Link from "next/link";

import { AuthForm } from "../auth-form";

export const metadata = { title: "Sign up — Sika Planner" };

export default function SignupPage() {
  return (
    <section className="stack">
      <h1>Sign up</h1>
      <p>Two minutes to your first zero-based budget.</p>
      <AuthForm mode="signup" />
      <p>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </section>
  );
}
