import Link from "next/link";

import { AuthForm } from "../auth-form";

export const metadata = { title: "Log in — Sika Planner" };

export default function LoginPage() {
  return (
    <section className="stack">
      <h1>Log in</h1>
      <p>Welcome back — your plan is waiting.</p>
      <AuthForm mode="login" />
      <p>
        New here? <Link href="/signup">Create an account</Link>
      </p>
    </section>
  );
}
