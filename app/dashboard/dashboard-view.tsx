"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  confirmLifeEventAction,
  dismissLifeEventAction,
} from "@/app/actions/life-events";
import { formatCents } from "@/lib/money";
import type {
  DashboardCategoryRow,
  DashboardSectionId,
  DashboardSnapshot,
  DashboardTransactionRow,
} from "@/lib/repositories/dashboard";
import { LIFE_EVENT_KIND_LABELS } from "@/lib/repositories/dashboard";

import styles from "./dashboard.module.css";

// ─── Presentation helpers (pure — engine data in, display strings out) ──────

/** CSS modifier for a row's engine state (taupe default, muted red/amber). */
function stateClass(state: DashboardCategoryRow["state"]): string {
  if (state === "overspent") return styles.overspent;
  if (state === "watch") return styles.watch;
  return "";
}

/** Fill width for a category's taupe progress hairline (clamped, like the primitive). */
function spendPercent(spentCents: number, assignedCents: number): number {
  if (assignedCents > 0) {
    return Math.min(100, Math.round((spentCents / assignedCents) * 100));
  }
  return spentCents > 0 ? 100 : 0;
}

function overspentRows(snapshot: DashboardSnapshot): DashboardCategoryRow[] {
  return snapshot.sections
    .flatMap((section) => section.categories)
    .filter((row) => row.state === "overspent");
}

/**
 * The hero's one-line nudge — the single most useful thing to know right
 * now, in Sika's voice. States facts the engine already computed; it never
 * invents a recommendation ("move $X from A to B") the engine didn't make.
 */
function heroNudge(snapshot: DashboardSnapshot): string {
  const { danger } = snapshot;
  if (danger.overall === "overspent") {
    // Name the worst shortfall as a fact. The fix (if any) lives in the
    // Attention area — never synthesized here.
    const worst = overspentRows(snapshot).reduce<DashboardCategoryRow | null>(
      (acc, row) =>
        acc === null || row.availableCents < acc.availableCents ? row : acc,
      null,
    );
    return worst
      ? `${worst.name} is ${formatCents(-worst.availableCents)} over plan.`
      : "Sika found something that needs attention.";
  }
  if (danger.fundingBehindCount > 0) {
    return "A fund is off pace for its target date.";
  }
  if (danger.watchCount > 0) {
    return danger.watchCount === 1
      ? "You're on track, but one category is close to its limit."
      : `You're on track, but ${danger.watchCount} categories are close to their limit.`;
  }
  return "You're on track.";
}

// ─── Tier 1 · Hero ───────────────────────────────────────────────────────────

/**
 * Month, money left, spent-of-planned — typography and whitespace define
 * the surface; no bordered card (v1.1: cards are earned). With zero
 * transactions the same surface reads as "ready to plan" with a CTA.
 */
function Hero({ snapshot }: { snapshot: DashboardSnapshot }) {
  if (!snapshot.hasTransactions) {
    return (
      <section className={styles.hero} data-testid="hero" data-empty="">
        <p className={styles.heroEyebrow}>{snapshot.monthLabel}</p>
        <p className={styles.heroValue} data-testid="ready-to-plan">
          {formatCents(snapshot.income.expectedCents)}
        </p>
        <p className={styles.heroSupport}>ready to plan — nothing assigned yet</p>
        <Link href="/planner" className={styles.heroCta}>
          Plan the month
        </Link>
      </section>
    );
  }

  const moneyLeft = snapshot.budget.assignedCents - snapshot.budget.spentCents;
  return (
    <section className={styles.hero} data-testid="hero">
      <p className={styles.heroEyebrow}>{snapshot.monthLabel}</p>
      <p
        className={`${styles.heroValue} ${moneyLeft < 0 ? styles.heroValueOver : ""}`}
        data-testid="money-left"
      >
        {formatCents(moneyLeft)}
      </p>
      <p className={styles.heroSupport} data-testid="spent-of-planned">
        {formatCents(snapshot.budget.spentCents)} spent of{" "}
        {formatCents(snapshot.budget.assignedCents)} planned
      </p>
      <p className={styles.heroNudge} data-testid="hero-nudge">
        {heroNudge(snapshot)}
      </p>
    </section>
  );
}

// ─── Tier 2 · Your plan ──────────────────────────────────────────────────────

/**
 * The dashboard's plan view: Needs / Wants / Savings & goals, open rows with
 * hairline separators, taupe progress. The v1 sections' funds, debts, and
 * investments stay in the snapshot for other surfaces — the composition
 * simply doesn't render them (nothing deleted, git history is the rollback).
 */
const PLAN_GROUPS: ReadonlyArray<{
  id: string;
  title: string;
  sectionIds: readonly DashboardSectionId[];
}> = [
  { id: "needs", title: "Needs", sectionIds: ["needs"] },
  { id: "wants", title: "Wants", sectionIds: ["wants"] },
  {
    id: "savings",
    title: "Savings & goals",
    // Debt payoff joins the goals: its category row (with the overspent
    // state) stays visible even though the owed-account rows do not render.
    sectionIds: ["savings-funds", "investments", "debts"],
  },
];

function PlanRow({ row }: { row: DashboardCategoryRow }) {
  const over = row.state === "overspent" && row.availableCents < 0;
  return (
    <li
      className={`${styles.planRow} ${stateClass(row.state)}`}
      data-state={row.state}
    >
      <div className={styles.planRowTop}>
        <span className={styles.planRowName}>{row.name}</span>
        <span className={styles.planRowLeft} data-testid="category-left">
          {over
            ? `${formatCents(-row.availableCents)} over`
            : `${formatCents(row.availableCents)} left`}
        </span>
      </div>
      <div
        className={styles.planRowTrack}
        role="progressbar"
        aria-label={row.name}
        aria-valuenow={row.spentCents}
        aria-valuemin={0}
        aria-valuemax={row.assignedCents}
        aria-valuetext={`${formatCents(row.spentCents)} of ${formatCents(row.assignedCents)}`}
      >
        <div
          className={styles.planRowFill}
          style={{ width: `${spendPercent(row.spentCents, row.assignedCents)}%` }}
        />
      </div>
      <p className={styles.planRowMeta}>
        {formatCents(row.spentCents)} spent of {formatCents(row.assignedCents)}{" "}
        planned
      </p>
    </li>
  );
}

function Plan({ snapshot }: { snapshot: DashboardSnapshot }) {
  const byId = new Map(
    snapshot.sections.map((section) => [section.id, section] as const),
  );

  return (
    <section className={styles.plan} data-testid="plan">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Your plan</h2>
        {snapshot.hasTransactions ? (
          snapshot.readyToAssignCents > 0 ? (
            <Link
              href="/planner"
              className={styles.sectionAction}
              data-testid="ready-to-assign"
            >
              {formatCents(snapshot.readyToAssignCents)} ready to assign
            </Link>
          ) : (
            <p className={styles.sectionAction} data-testid="plan-balanced">
              Your plan is balanced.
            </p>
          )
        ) : null}
      </div>

      {PLAN_GROUPS.map((group) => {
        const rows = group.sectionIds.flatMap(
          (id) => byId.get(id)?.categories ?? [],
        );
        return (
          <div
            key={group.id}
            className={styles.group}
            data-testid={`plan-group-${group.id}`}
          >
            <h3 className={styles.groupTitle}>{group.title}</h3>
            {rows.length === 0 ? (
              <p className={`muted ${styles.groupEmpty}`}>
                Nothing planned here yet.
              </p>
            ) : (
              <ul className={styles.rowList}>
                {rows.map((row) => (
                  <PlanRow key={row.categoryId} row={row} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ─── Tier 3 · Attention ──────────────────────────────────────────────────────

/**
 * The one earned card: existing actionable conditions only — the quiet
 * danger summary when the engine says something needs eyes, and advisor
 * candidates awaiting their confirmation gate. Nothing is fabricated here;
 * every line renders data the snapshot already carried.
 */
function Attention({ snapshot }: { snapshot: DashboardSnapshot }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const events = snapshot.lifeEvents;
  const { overall } = snapshot.danger;
  const needsEyes = overall === "overspent" || overall === "funding-behind";

  if (!needsEyes && events.length === 0) return null;

  async function run(
    key: string,
    action: () => Promise<{ ok: boolean; error: string | null }>,
  ) {
    setError(null);
    setBusy(key);
    try {
      const result = await action();
      if (!result.ok && result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.attention} data-testid="attention">
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}

      {needsEyes ? (
        <div data-testid="danger-summary">
          <p className={styles.attentionHeading}>
            Sika found something that needs attention.
          </p>
          <p className={styles.attentionDetail}>
            {overall === "overspent" ? (
              <Link href="/planner">Move money to cover it in the planner</Link>
            ) : (
              "A fund is off pace — top it up or move the date in Funds & Goals."
            )}
          </p>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div data-testid="life-events">
          <p className={styles.attentionHeading}>
            Planning around something new?
          </p>
          <ul className={styles.attentionList}>
            {events.map((event) => (
              <li key={event.id} className={styles.attentionItem}>
                <div className={styles.attentionCopy}>
                  <span className={styles.attentionKind}>
                    {LIFE_EVENT_KIND_LABELS[event.kind]}
                  </span>
                  {event.evidence ? (
                    <span className={`muted ${styles.attentionEvidence}`}>
                      {event.evidence}
                    </span>
                  ) : null}
                </div>
                <div className={styles.attentionActions}>
                  <button
                    type="button"
                    className={styles.confirmBtn}
                    disabled={busy !== null}
                    onClick={() =>
                      run(`confirm:${event.id}`, () =>
                        confirmLifeEventAction(event.id),
                      )
                    }
                  >
                    {busy === `confirm:${event.id}` ? "Confirming…" : "Confirm"}
                  </button>
                  <button
                    type="button"
                    className={styles.quietBtn}
                    disabled={busy !== null}
                    onClick={() =>
                      run(`dismiss:${event.id}`, () =>
                        dismissLifeEventAction(event.id),
                      )
                    }
                  >
                    {busy === `dismiss:${event.id}` ? "Dismissing…" : "Not now"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ─── Tier 4 · Recent activity ────────────────────────────────────────────────

/**
 * A quiet typeset glimpse of the newest transactions — payee, amount,
 * category if available, account, date. A glimpse, not the Activity page.
 */
function RecentActivity({
  transactions,
}: {
  transactions: DashboardTransactionRow[];
}) {
  return (
    <section className={styles.activity} data-testid="recent-activity">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Recent activity</h2>
        <Link href="/transactions" className={styles.sectionAction}>
          See all
        </Link>
      </div>

      {transactions.length === 0 ? (
        <p className={`muted ${styles.activityEmpty}`} data-testid="activity-empty">
          Nothing yet — spending you record shows up here.
        </p>
      ) : (
        <ul className={styles.activityList} data-testid="activity-list">
          {transactions.map((tx) => (
            <li key={tx.id} className={styles.activityRow}>
              <div className={styles.activityCopy}>
                <span className={styles.activityPayee}>{tx.payee}</span>
                <span className="muted">
                  {[tx.category, tx.account, tx.dateLabel]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <span className={styles.activityAmount}>
                {tx.amountCents >= 0 ? "+" : ""}
                {formatCents(tx.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── The view ────────────────────────────────────────────────────────────────

/**
 * The v1.1 dashboard (spec §Screens): hero → your plan → attention →
 * recent activity, in that render order. One composition for every
 * household — with zero transactions the structure stays, the numbers
 * read "ready to plan", and the empties stay quiet.
 */
export function DashboardView({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <div className={styles.dashboard} data-testid="dashboard">
      <Hero snapshot={snapshot} />
      <Plan snapshot={snapshot} />
      <Attention snapshot={snapshot} />
      <RecentActivity transactions={snapshot.recentTransactions} />
    </div>
  );
}
