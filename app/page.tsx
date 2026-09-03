import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Sika Planner</h1>
      <p>
        Zero-based budgeting that answers one question instantly: how much do I
        actually have left, right now, in every category.
      </p>
      <p>
        <Link href="/signup">Sign up</Link> · <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
