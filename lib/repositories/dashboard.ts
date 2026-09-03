/**
 * Dashboard repository (D7): "position at a glance" per the mock-up —
 * budget progress, income received vs expected, the five mock-up sections,
 * net worth, the danger strip, and pending life events.
 *
 * Like the planner (D6), every number the dashboard renders comes from the
 * engine reading hydrated household state — the UI never re-derives money
 * math. Ready to Assign here is the engine's cash-based figure (income
 * transactions received − assigned); the onboarding scaffold's income-based
 * approximation is retired by this screen.
 */

import type { DangerState } from "@/src/engine";
import {
  createBudgetEngine,
  type CategoryAvailable,
  type CategoryGroup,
} from "@/src/engine";

import { ensureMonthCovers } from "./transactions";
import { loadHouseholdEngineState, type Db } from "./engine-state";

import { runLifeEventDetection } from "./life-events";

// ─── View model ──────────────────────────────────────────────────────────────

export interface DashboardCategoryRow {
  categoryId: string;
  name: string;
  assignedCents: number;
  spentCents: number;
  availableCents: number;
  /** Engine danger verdict for this category in the viewed month. */
  state: DangerState;
}

export interface DashboardFundRow {
  id: string;
  name: string;
  kind: "SINKING" | "STATIC";
  balanceCents: number;
  targetCents: number | null;
}

export interface DashboardDebtRow {
  id: string;
  name: string;
  /** Positive amount currently owed on the account. */
  owedCents: number;
}

export type DashboardSectionId =
  | "savings-funds"
  | "needs"
  | "wants"
  | "debts"
  | "investments";

export interface DashboardSection {
  id: DashboardSectionId;
  title: string;
  categories: DashboardCategoryRow[];
  /** Savings & Funds only: the household's funds with balances. */
  funds?: DashboardFundRow[];
  /** Debts only: credit accounts and what is owed on them. */
  debts?: DashboardDebtRow[];
}

export type LifeEventKind =
  | "HOME_PURCHASE"
  | "MOVE"
  | "WEDDING"
  | "CHILD"
  | "CUSTOM";

export interface DashboardLifeEvent {
  id: string;
  kind: LifeEventKind;
  /** Human-readable detector summary shown inline on the card. */
  evidence: string | null;
}

export interface DashboardSnapshot {
  monthId: string;
  year: number;
  /** 1–12. */
  month: number;
  /** "September 2026" — computed server-side so the locale is deterministic. */
  monthLabel: string;
  /** False → the dashboard renders its zero-transaction empty state. */
  hasTransactions: boolean;
  /** Cash-based Ready to Assign: income received − assigned (engine view). */
  readyToAssignCents: number;
  budget: {
    /** Spending charged this month at transaction time. */
    spentCents: number;
    /** The month's plan: total assigned across categories. */
    assignedCents: number;
  };
  income: {
    receivedCents: number;
    expectedCents: number;
    /** Sinking/static draws released this month — cashflow, never income. */
    fundDrawCents: number;
  };
  /** Σ derived account balances (credit accounts count as negative). */
  netWorthCents: number;
  accountCount: number;
  danger: {
    overall: DangerState;
    watchCount: number;
    overspentCount: number;
    fundingBehindCount: number;
  };
  /** Five mock-up sections in mock-up order. */
  sections: DashboardSection[];
  /** Advisor candidates awaiting confirm/dismiss (D11 seam). */
  lifeEvents: DashboardLifeEvent[];
}

export const LIFE_EVENT_KIND_LABELS: Record<LifeEventKind, string> = {
  HOME_PURCHASE: "Home purchase",
  MOVE: "Move",
  WEDDING: "Wedding",
  CHILD: "Child",
  CUSTOM: "Something else",
};

// ─── Section assembly (pure, unit-testable) ─────────────────────────────────

/**
 * The mock-up renders "Savings & Funds" and "Debts" as separate sections, but
 * CategoryGroup collapses both into SAVINGS_DEBTS (seed comment, D2/D10). v1
 * has no structural debt flag, so the split keys on the category's own name:
 * anything saying "debt" is debt-side. The seed's starter categories land
 * correctly ("Debt Payoff" → Debts, "Savings & Funds" → Savings & Funds).
 */
export function isDebtCategory(name: string): boolean {
  return /\bdebts?\b/i.test(name);
}

export interface SectionInputs {
  categories: { id: string; name: string; group: CategoryGroup }[];
  availability: CategoryAvailable[];
  /** Danger verdict per category id for the viewed month. */
  stateByCategoryId: Map<string, DangerState>;
  funds: DashboardFundRow[];
  /** Credit accounts with a nonzero balance owed. */
  creditAccounts: DashboardDebtRow[];
}

/** Five sections in the mock-up's order, from categories, funds, and accounts. */
export function buildDashboardSections(
  inputs: SectionInputs,
): DashboardSection[] {
  const availableById = new Map(
    inputs.availability.map((a) => [a.categoryId, a] as const),
  );

  const rowsFor = (group: CategoryGroup): DashboardCategoryRow[] =>
    inputs.categories
      .filter((c) => c.group === group)
      .map((c) => {
        const row = availableById.get(c.id);
        return {
          categoryId: c.id,
          name: c.name,
          assignedCents: row?.assignedCents ?? 0,
          spentCents: row?.spentCents ?? 0,
          availableCents: row?.availableCents ?? 0,
          state: inputs.stateByCategoryId.get(c.id) ?? "healthy",
        };
      });

  return [
    {
      id: "savings-funds",
      title: "Savings & Funds",
      categories: rowsFor("SAVINGS_DEBTS").filter(
        (row) => !isDebtCategory(row.name),
      ),
      funds: inputs.funds,
    },
    { id: "needs", title: "Needs", categories: rowsFor("NEEDS") },
    { id: "wants", title: "Wants", categories: rowsFor("WANTS") },
    {
      id: "debts",
      title: "Debts",
      categories: rowsFor("SAVINGS_DEBTS").filter((row) =>
        isDebtCategory(row.name),
      ),
      debts: inputs.creditAccounts,
    },
    {
      id: "investments",
      title: "Investments",
      categories: rowsFor("INVESTMENTS"),
    },
  ];
}

function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

/**
 * Everything the dashboard screen renders, computed by the engine: scaffold
 * the month covering `today`, then read cashflow, Ready to Assign,
 * availability, net worth, and the danger report from hydrated state.
 */
export async function getDashboardSnapshot(
  db: Db,
  householdId: string,
  today: string,
): Promise<DashboardSnapshot> {
  const monthId = await ensureMonthCovers(db, householdId, today);
  const state = await loadHouseholdEngineState(db, householdId);
  const engine = createBudgetEngine(state);

  const month = state.months.find((m) => m.id === monthId);
  if (!month) {
    // Unreachable — ensureMonthCovers just created or found it — but the
    // narrowing keeps the return honest instead of asserting.
    throw new Error(`dashboard: month ${monthId} missing after scaffolding`);
  }

  const cashflow = engine.monthCashflow(monthId);
  const availability = engine.categoryAvailable(monthId);
  const danger = engine.dangerZone(monthId);

  const assignedCents = engine
    .allocationsOf(monthId)
    .reduce((sum, a) => sum + a.assignedCents, 0);

  const balances = state.accounts.map((account) => ({
    account,
    balanceCents: engine.accountBalanceCents(account.id),
  }));
  const netWorthCents = balances.reduce(
    (sum, b) => sum + b.balanceCents,
    0,
  );

  const stateByCategoryId = new Map(
    danger.categories.map((c) => [c.categoryId, c.state] as const),
  );

  const funds: DashboardFundRow[] = state.funds.map((fund) => ({
    id: fund.id,
    name: fund.name,
    kind: fund.kind,
    balanceCents: fund.balanceCents,
    targetCents: fund.targetCents ?? null,
  }));

  const creditAccounts: DashboardDebtRow[] = balances
    .filter((b) => b.account.kind === "CREDIT" && b.balanceCents < 0)
    .map((b) => ({
      id: b.account.id,
      name: b.account.name,
      owedCents: -b.balanceCents,
    }));

  const sections = buildDashboardSections({
    categories: state.categories.map(({ id, name, group }) => ({
      id,
      name,
      group,
    })),
    availability,
    stateByCategoryId,
    funds,
    creditAccounts,
  });

  // Detection pass (D11) before the candidates read: new confirmed
  // categorizations become Life events card candidates here, so the card is
  // always current and detection stays idempotent.
  await runLifeEventDetection(db, householdId, today);

  const lifeEvents = await db.lifeEvent.findMany({
    where: { householdId, status: "CANDIDATE" },
    select: { id: true, kind: true, evidence: true },
    orderBy: { id: "asc" },
  });

  return {
    monthId,
    year: month.year,
    month: month.month,
    monthLabel: monthLabel(month.year, month.month),
    hasTransactions: state.transactions.length > 0,
    readyToAssignCents: engine.readyToAssignCents(monthId),
    budget: { spentCents: cashflow.spendingCents, assignedCents },
    income: {
      receivedCents: cashflow.incomeReceivedCents,
      expectedCents: month.expectedIncomeCents,
      fundDrawCents: cashflow.fundDrawCents,
    },
    netWorthCents,
    accountCount: state.accounts.length,
    danger: {
      overall: danger.overall,
      watchCount: danger.categories.filter((c) => c.state === "watch").length,
      overspentCount: danger.categories.filter((c) => c.state === "overspent")
        .length,
      fundingBehindCount: danger.funds.filter(
        (f) => f.state === "funding-behind",
      ).length,
    },
    sections,
    lifeEvents: lifeEvents.map((event) => ({
      id: event.id,
      kind: event.kind as LifeEventKind,
      evidence: event.evidence,
    })),
  };
}
