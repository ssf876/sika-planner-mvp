// Engine domain types — pure TypeScript, zero DB or framework imports (D2).
//
// These mirror the Prisma models/enums in prisma/schema.prisma (the hydration
// layer maps rows into this state), but the engine itself never imports Prisma.
// Money is integer cents everywhere (spec A1); dates are household-local
// calendar dates (spec A4), held as ISO "YYYY-MM-DD" strings.

export type AccountKind =
  "CHECKING" | "SAVINGS" | "CREDIT" | "CASH" | "INVESTMENT";
export type CategoryGroup = "NEEDS" | "WANTS" | "SAVINGS_DEBTS" | "INVESTMENTS";
export type TxKind = "INCOME" | "EXPENSE" | "TRANSFER";
export type ReviewState =
  "AUTO_ACCEPTED" | "NEEDS_REVIEW" | "CONFIRMED" | "EDITED";
export type FundKind = "SINKING" | "STATIC";
export type RiskAppetite = "CAUTIOUS" | "BALANCED" | "AGGRESSIVE";

export interface Account {
  id: string;
  householdId: string;
  kind: AccountKind;
  name: string;
  startingCents: number;
}

export interface Category {
  id: string;
  householdId: string;
  group: CategoryGroup;
  name: string;
  /** Companion fund, when this category is funded by one (mirrors Category.fundId). */
  fundId?: string;
}

export interface BudgetMonth {
  id: string;
  householdId: string;
  /** Calendar year, household-local (spec A4). */
  year: number;
  /** 1–12. */
  month: number;
  expectedIncomeCents: number;
}

export interface Allocation {
  monthId: string;
  categoryId: string;
  assignedCents: number;
}

export interface Fund {
  id: string;
  householdId: string;
  kind: FundKind;
  name: string;
  targetCents?: number;
  targetDate?: string;
  /** contributions − payouts + adjustments. */
  balanceCents: number;
}

export interface FundDraw {
  id: string;
  fundId: string;
  monthId: string;
  /** Positive amount paid out of the fund; recorded as cashflow income of `monthId`. */
  amountCents: number;
}

export interface Transaction {
  id: string;
  accountId: string;
  categoryId?: string;
  /** Set when a fund draw paid this expense. */
  fundDrawId?: string;
  kind: TxKind;
  /** Signed; positive = money in. */
  amountCents: number;
  /** Household-local ISO date ("YYYY-MM-DD"); the month is derived from it. */
  date: string;
  payee: string;
  note?: string;
  externalId?: string;
  pending: boolean;
  reviewState: ReviewState;
}

/** Two-account money movement — ATM withdrawal, credit-card payment, goal settlement. */
export interface Transfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  /** Positive; moves `amountCents` out of `fromAccountId` into `toAccountId`. */
  amountCents: number;
  date: string;
  payee: string;
}

export interface EngineState {
  householdId: string;
  /** Household risk posture (mirrors Household.riskAppetite @default(BALANCED)). */
  riskAppetite?: RiskAppetite;
  accounts: Account[];
  categories: Category[];
  months: BudgetMonth[];
  allocations: Allocation[];
  transactions: Transaction[];
  funds: Fund[];
  fundDraws: FundDraw[];
  transfers: Transfer[];
}

export interface TransactionInput {
  accountId: string;
  kind: TxKind;
  /** Signed; positive = money in, negative = money out. */
  amountCents: number;
  date: string | Date;
  payee: string;
  /** Required for EXPENSE: any outflow depletes its category at transaction time. */
  categoryId?: string;
  note?: string;
  externalId?: string;
  pending?: boolean;
  reviewState?: ReviewState;
}

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  /** Positive; moves `amountCents` from one account to the other. */
  amountCents: number;
  date: string | Date;
  payee: string;
}

// ─── Contract (spec, "The engine is a pure core with five operations") ──────

export interface CategoryAvailable {
  categoryId: string;
  assignedCents: number;
  /** Card + cash outflows charged to this category (incl. pending). */
  spentCents: number;
  /** Sinking-fund draws releasing cash this month. */
  cashflowReleasedCents: number;
  /** assigned − spent + released. */
  availableCents: number;
}

export interface BudgetEngine {
  /** Zero-based planning: sum of assignments must land Ready to Assign at 0. */
  readyToAssignCents(monthId: string): number;
  assign(monthId: string, categoryId: string, cents: number): void;
  /** "Flex to this month's needs": start from last month, then edit. */
  copyPreviousMonth(monthId: string): void;
  /** Any outflow — card, cash, or check — depletes the category at transaction time. */
  recordTransaction(tx: TransactionInput): CategoryAvailable[];
  /** Bank → wallet move. Touches two accounts, zero categories, zero cashflow. */
  withdrawToCash(
    accountId: string,
    cents: number,
    date?: string | Date,
  ): string;
  /**
   * Sinking fund pays a pop-up: fund −, expense posts, month's available cash +
   * (cashflow, never income).
   */
  drawFromFund(fundId: string, expense: TransactionInput): string;
  /** Static goals never move on their own; only an explicit draw does, and it reports as "popped up". */
  drawFromStaticGoal(fundId: string, cents: number, monthId: string): string;
}

// ─── Read views and runtime extras (additive; the 7-op contract above stands) ──

export interface MonthCashflow {
  monthId: string;
  /** Income transactions received this month — the only thing that feeds Ready to Assign. */
  incomeReceivedCents: number;
  /** Fund draws released this month ("popped up"): counts as that month's income, never paycheck income. */
  fundDrawCents: number;
  /** Outflows charged this month at transaction time (a card purchase counts here even though it settles later). */
  spendingCents: number;
  /** income + fund draws − spending. Transfers are internal and never appear. */
  netCashflowCents: number;
}

// ─── Danger zone (spec: "Danger zone is an engine view, not a UI afterthought")

/**
 * The four danger states are the contract (spec D6): consumers branch on
 * these, never on thresholds. Severity: overspent > funding-behind > watch.
 */
export type DangerState = "healthy" | "watch" | "overspent" | "funding-behind";

/**
 * Tunable thresholds, as integer percents so all classification math stays
 * in exact integer arithmetic. Per appetite: CAUTIOUS tightens (warns
 * earlier), AGGRESSIVE loosens (warns later).
 */
export interface DangerZoneThresholds {
  /**
   * Watch line as a percent of assigned: a category is on watch when
   * available ≤ floor(assigned × watchPercent / 100). BALANCED is 10 (spec:
   * "available ≤ 10% of assigned"); a category needs assigned > 0 to be
   * watchable at all.
   */
  watchPercent: Record<RiskAppetite, number>;
  /**
   * Fund-pace slack as a percent of the required monthly pace: a fund is
   * behind when its month's planned funding × 100 < required ×
   * paceFloorPercent. CAUTIOUS 100 = the plan must fully cover the pace.
   */
  paceFloorPercent: Record<RiskAppetite, number>;
}

export type DangerZoneThresholdOverrides = {
  [K in keyof DangerZoneThresholds]?: Partial<DangerZoneThresholds[K]>;
};

export interface DangerZoneOptions {
  /** Overrides the household appetite (EngineState.riskAppetite, default BALANCED) for this view. */
  riskAppetite?: RiskAppetite;
  /** Per-knob, per-appetite overrides merged over the defaults; percents must be integers 0–100. */
  thresholds?: DangerZoneThresholdOverrides;
}

/** Pace facts for one fund with a target and a target date, as of the viewed month. */
export interface FundPace {
  fundId: string;
  /** Cents still needed to reach targetCents (0 once met). */
  gapCents: number;
  /** Months of runway including the deadline month; 0 once the target month has passed. */
  monthsRemaining: number;
  /** Integer ceil of gap / monthsRemaining. Null when the deadline passed with the target unmet — see overdue. */
  requiredPerMonthCents: number | null;
  /** Viewed month's planned funding: the allocation to the fund's companion category. Null when the fund has no companion category. */
  plannedThisMonthCents: number | null;
  /** True when the viewed month is past the target month. */
  overdue: boolean;
}

export interface FundDangerState {
  fundId: string;
  /** Fund-level state — pace only ever makes a fund healthy or funding-behind. */
  state: Extract<DangerState, "healthy" | "funding-behind">;
  pace: FundPace;
}

export interface DangerCategoryState {
  categoryId: string;
  state: DangerState;
  assignedCents: number;
  availableCents: number;
  /** available ≤ this line ⇒ watch; null when assigned = 0 (nothing is watchable without a plan). */
  watchLineCents: number | null;
  /** Present when the category is backed by a fund with a target and a target date. */
  fundPace?: FundPace;
}

export interface DangerZoneReport {
  monthId: string;
  riskAppetite: RiskAppetite;
  /** Worst state across every category and overdue fund — what the dashboard strip shows. */
  overall: DangerState;
  categories: DangerCategoryState[];
  /** Pace facts for every fund with a target and a target date (companion-backed or standalone). */
  funds: FundDangerState[];
}

export interface BudgetEngineRuntime extends BudgetEngine {
  /** Per-category availability for a month, in category order. */
  categoryAvailable(monthId: string): CategoryAvailable[];
  /** Month cashflow ledger: income received, popped-up fund draws, spending. */
  monthCashflow(monthId: string): MonthCashflow;
  /** Derived balance: startingCents + Σ transaction amounts + Σ transfer movements. */
  accountBalanceCents(accountId: string): number;
  allocationsOf(monthId: string): Allocation[];
  fundBalanceCents(fundId: string): number;
  /**
   * General two-account move (credit-card payment, settling a static-goal draw
   * back into checking). Zero categories, zero cashflow — a transfer, not spending.
   */
  recordTransfer(input: TransferInput): string;
  /** Deep copy of the current engine state, for the persistence layer to diff/store. */
  snapshot(): EngineState;
  /**
   * Danger zone view (D3): per-category and overall states from the
   * household's riskAppetite, category availability, and fund pace.
   * Thresholds are tunable via options; the states are the contract.
   */
  dangerZone(monthId: string, options?: DangerZoneOptions): DangerZoneReport;
}
