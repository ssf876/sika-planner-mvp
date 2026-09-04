"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  confirmLifeEventAction,
  declareLifeEventAction,
  dismissLifeEventAction,
} from "@/app/actions/life-events";
import { Badge, Card, ProgressBar } from "@/components/ui";
import type { DangerTone } from "@/components/ui/types";
import { formatCents } from "@/lib/money";
import type {
  DashboardCategoryRow,
  DashboardLifeEvent,
  DashboardSection,
  DashboardSnapshot,
  LifeEventKind,
} from "@/lib/repositories/dashboard";
import { LIFE_EVENT_KIND_LABELS } from "@/lib/repositories/dashboard";

import styles from "./dashboard.module.css";

// ─── Danger vocabulary ───────────────────────────────────────────────────────

/** Visual tone for an engine danger state (funding-behind reads as a warning). */
function stateToTone(state: DashboardCategoryRow["state"]): DangerTone {
  return state === "overspent" ? "overspent" : state === "healthy" ? "healthy" : "watch";
}

const STATE_LABELS: Record<DashboardCategoryRow["state"], string> = {
  healthy: "Healthy",
  watch: "Watch",
  overspent: "Overspent",
  "funding-behind": "Funding behind",
};

const STRIP_COPY: Record<
  DashboardSnapshot["danger"]["overall"],
  { title: string; detail: (danger: DashboardSnapshot["danger"]) => string }
> = {
  healthy: {
    title: "All clear",
    detail: () => "Nothing needs attention right now.",
  },
  watch: {
    title: "Watch",
    detail: (danger) =>
      `${danger.watchCount} ${danger.watchCount === 1 ? "category is" : "categories are"} close to ${danger.watchCount === 1 ? "its" : "their"} limit.`,
  },
  overspent: {
    title: "Overspent",
    detail: (danger) =>
      `${danger.overspentCount} ${danger.overspentCount === 1 ? "category has" : "categories have"} spent past the plan — move money to cover it.`,
  },
  "funding-behind": {
    title: "Funding behind",
    detail: () =>
      "A fund is off pace for its target date — top it up or move the date.",
  },
};

function DangerStrip({ danger }: { danger: DashboardSnapshot["danger"] }) {
  const copy = STRIP_COPY[danger.overall];
  return (
    <Card
      tone={danger.overall === "healthy" ? "neutral" : stateToTone(danger.overall)}
      className={styles.strip}
      data-testid="danger-strip"
    >
      <p className={styles.stripTitle}>
        <strong>{copy.title}</strong> {copy.detail(danger)}
      </p>
    </Card>
  );
}

// ─── Metric cards ────────────────────────────────────────────────────────────

function BudgetCard({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <Card className={styles.metricCard}>
      {/* Mock-up grammar: "April Budget — $2,500 spent of $5,500". */}
      <ProgressBar
        label={`${snapshot.monthLabel} budget — ${formatCents(
          snapshot.budget.spentCents,
        )} spent of ${formatCents(snapshot.budget.assignedCents)}`}
        value={snapshot.budget.spentCents}
        max={snapshot.budget.assignedCents}
        hideAmounts
      />
      <p className="muted">
        Ready to assign{" "}
        <strong data-testid="ready-to-assign">
          {formatCents(snapshot.readyToAssignCents)}
        </strong>{" "}
        — assign every dollar in the{" "}
        <Link href="/planner">monthly planner</Link>.
      </p>
    </Card>
  );
}

function IncomeCard({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <Card className={styles.metricCard}>
      <h2>Income</h2>
      <p className={styles.metricValue} data-testid="income-line">
        {formatCents(snapshot.income.receivedCents)} received of{" "}
        {formatCents(snapshot.income.expectedCents)} expected
      </p>
      {snapshot.income.fundDrawCents > 0 ? (
        <p className="muted">
          Plus {formatCents(snapshot.income.fundDrawCents)} popped up from
          funds — cashflow, never paycheck income.
        </p>
      ) : (
        <p className="muted">
          Recorded income lands here and feeds Ready to Assign.
        </p>
      )}
    </Card>
  );
}

function NetWorthCard({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <Card className={styles.metricCard}>
      <h2>Net worth</h2>
      <p className={styles.netWorth} data-testid="net-worth">
        {formatCents(snapshot.netWorthCents)}
      </p>
      <p className="muted">
        Across {snapshot.accountCount}{" "}
        {snapshot.accountCount === 1 ? "account" : "accounts"} — credit
        balances count against it.
      </p>
    </Card>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function CategoryRow({ row }: { row: DashboardCategoryRow }) {
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <ProgressBar
          label={row.name}
          value={row.spentCents}
          max={row.assignedCents}
          tone={stateToTone(row.state)}
        />
        <p className={`muted ${styles.rowAvailable}`}>
          {formatCents(row.availableCents)} available
        </p>
      </div>
      {row.state !== "healthy" ? (
        <Badge tone={stateToTone(row.state)}>{STATE_LABELS[row.state]}</Badge>
      ) : null}
    </li>
  );
}

function SectionCard({ section }: { section: DashboardSection }) {
  const nothing =
    section.categories.length === 0 &&
    (section.funds?.length ?? 0) === 0 &&
    (section.debts?.length ?? 0) === 0;

  return (
    <Card className={styles.section} data-testid={`section-${section.id}`}>
      <h2>{section.title}</h2>
      {nothing ? (
        <p className="muted">
          Nothing planned here yet — assign this section in the{" "}
          <Link href="/planner">planner</Link>.
        </p>
      ) : (
        <ul className={styles.rowList}>
          {section.categories.map((row) => (
            <CategoryRow key={row.categoryId} row={row} />
          ))}
          {section.funds?.map((fund) => (
            <li key={fund.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowLabel}>{fund.name}</span>
                <p className={styles.rowAvailable}>
                  {formatCents(fund.balanceCents)}
                  {fund.targetCents != null
                    ? ` toward ${formatCents(fund.targetCents)}`
                    : " saved"}{" "}
                  · {fund.kind === "SINKING" ? "sinking fund" : "static goal"}
                </p>
              </div>
            </li>
          ))}
          {section.debts?.map((debt) => (
            <li key={debt.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowLabel}>{debt.name}</span>
                <p className={styles.rowAvailable}>
                  {formatCents(debt.owedCents)} owed
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Life events card (advisor seam, D11/D12) ───────────────────────────────

function LifeEventsCard({
  events,
}: {
  events: DashboardLifeEvent[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declareKind, setDeclareKind] = useState<LifeEventKind>("MOVE");

  async function run(key: string, action: () => Promise<{ ok: boolean; error: string | null }>) {
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

  const kindOptions = Object.entries(LIFE_EVENT_KIND_LABELS) as [
    LifeEventKind,
    string,
  ][];

  return (
    <Card className={styles.section} data-testid="life-events-card">
      <h2>Life events</h2>

      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}

      {events.length === 0 ? (
        <p className="muted" data-testid="life-events-empty">
          Nothing new detected — declare a life change if one just happened.
        </p>
      ) : (
        <ul className={styles.rowList}>
          {events.map((event) => (
            <li key={event.id} className={styles.candidate}>
              <div className={styles.rowMain}>
                <strong>{LIFE_EVENT_KIND_LABELS[event.kind]}</strong>
                {event.evidence ? <p className="muted">{event.evidence}</p> : null}
              </div>
              <div className={styles.candidateActions}>
                <button
                  type="button"
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
                  disabled={busy !== null}
                  onClick={() =>
                    run(`dismiss:${event.id}`, () =>
                      dismissLifeEventAction(event.id),
                    )
                  }
                >
                  {busy === `dismiss:${event.id}` ? "Dismissing…" : "Dismiss"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.declareRow}>
        <label>
          <select
            aria-label="Declare a life change"
            value={declareKind}
            onChange={(e) => setDeclareKind(e.target.value as LifeEventKind)}
            disabled={busy !== null}
          >
            {kindOptions.map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            run("declare", () => declareLifeEventAction(declareKind))
          }
        >
          {busy === "declare" ? "Declaring…" : "Declare"}
        </button>
      </div>
      <p className="muted">
        Confirming turns a detected season into a plan you apply line by line;
        dismissing suppresses that rule. Declaring records your own season —
        useful before any history exists.
      </p>
    </Card>
  );
}

// ─── Zero-transaction empty state ────────────────────────────────────────────

function EmptyDashboard() {
  return (
    <Card className={styles.emptyHero} data-testid="dashboard-empty">
      <h2>Your dashboard fills in as money moves</h2>
      <p>
        Spending you enter or import will show up here and deplete category
        availability in real time. Recorded income feeds Ready to Assign, and
        your accounts build the net-worth figure.
      </p>
      <p>
        Start by planning the month — every dollar gets a job before anything
        is spent.
      </p>
      <p>
        <Link href="/planner" className={styles.emptyLink}>
          Plan the month →
        </Link>
      </p>
    </Card>
  );
}

// ─── The view ────────────────────────────────────────────────────────────────

/**
 * The home screen (D7): budget progress, income received vs expected, the
 * five mock-up sections, net worth, the danger strip, and the Life events
 * card — with a zero-transaction empty state that points at the planner.
 */
export function DashboardView({ snapshot }: { snapshot: DashboardSnapshot }) {
  if (!snapshot.hasTransactions) {
    return (
      <div className="stack">
        <EmptyDashboard />
        <LifeEventsCard events={snapshot.lifeEvents} />
      </div>
    );
  }

  return (
    <div className="stack">
      <DangerStrip danger={snapshot.danger} />
      <div className={styles.metrics}>
        <BudgetCard snapshot={snapshot} />
        <IncomeCard snapshot={snapshot} />
        <NetWorthCard snapshot={snapshot} />
      </div>
      <div className={styles.sectionGrid}>
        {snapshot.sections.map((section) => (
          <SectionCard key={section.id} section={section} />
        ))}
      </div>
      <LifeEventsCard events={snapshot.lifeEvents} />
    </div>
  );
}
