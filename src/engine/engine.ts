// The budget engine — a pure core over EngineState. Deterministic and
// side-effect-free given persisted state, which is what makes it exhaustively
// unit-testable (spec: "The engine is a pure core with five operations").
//
// Zero DB or framework imports: the hydration layer maps Prisma rows into
// EngineState and diffs snapshot() back out.

import type {
  Allocation,
  AnnualSummary,
  AnnualSummaryOptions,
  BudgetEngineRuntime,
  CategoryAvailable,
  DangerCategoryState,
  DangerState,
  DangerZoneOptions,
  DangerZoneReport,
  EngineState,
  FundDangerState,
  FundPace,
  PlannedVsActualReport,
  PvaOptions,
  RiskAppetite,
  Transaction,
  TransactionInput,
  TransferInput,
} from "./types";
import {
  assessFundPace,
  classifyAvailability,
  computeFundPace,
  resolveDangerThresholds,
  watchLineCents,
  worstDangerState,
} from "./danger";
import { EngineError } from "./errors";
import {
  buildAnnualSummary,
  buildPlannedVsActual,
  computeMonthCashflow,
} from "./pva";
import {
  assertIntegerCents,
  assertPositiveCents,
  calendarMonth,
  normalizeDate,
  previousCalendarMonth,
} from "./invariants";

export interface EngineDeps {
  /** Injectable for deterministic tests; defaults to crypto.randomUUID. */
  generateId?: () => string;
}

const defaultGenerateId = (): string => crypto.randomUUID();

const monthLabel = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, "0")}`;

export function createBudgetEngine(
  input: EngineState,
  deps: EngineDeps = {},
): BudgetEngineRuntime {
  // Deep-copy up front: the caller's state is never mutated by engine ops.
  const state: EngineState = structuredClone(input);
  const generateId = deps.generateId ?? defaultGenerateId;

  // ── lookups ────────────────────────────────────────────────────────────────

  const requireMonth = (monthId: string) => {
    const month = state.months.find((m) => m.id === monthId);
    if (!month)
      throw new EngineError("UNKNOWN_MONTH", `no month with id "${monthId}"`);
    return month;
  };

  const requireMonthByCalendar = (date: string) => {
    const { year, month } = calendarMonth(date);
    const found = state.months.find(
      (m) => m.year === year && m.month === month,
    );
    if (!found)
      throw new EngineError(
        "UNKNOWN_MONTH",
        `no month covers ${monthLabel(year, month)} — create the month first`,
      );
    return found;
  };

  const requireCategory = (categoryId: string) => {
    const category = state.categories.find((c) => c.id === categoryId);
    if (!category)
      throw new EngineError(
        "UNKNOWN_CATEGORY",
        `no category with id "${categoryId}"`,
      );
    return category;
  };

  const requireAccount = (accountId: string) => {
    const account = state.accounts.find((a) => a.id === accountId);
    if (!account)
      throw new EngineError(
        "UNKNOWN_ACCOUNT",
        `no account with id "${accountId}"`,
      );
    return account;
  };

  const requireFund = (fundId: string) => {
    const fund = state.funds.find((f) => f.id === fundId);
    if (!fund)
      throw new EngineError("UNKNOWN_FUND", `no fund with id "${fundId}"`);
    return fund;
  };

  // ── derived views ──────────────────────────────────────────────────────────

  const sameCalendarMonth = (
    date: string,
    target: { year: number; month: number },
  ): boolean => {
    const { year, month } = calendarMonth(date);
    return year === target.year && month === target.month;
  };

  const transactionsInMonth = (monthId: string): Transaction[] => {
    const target = requireMonth(monthId);
    return state.transactions.filter((tx) =>
      sameCalendarMonth(tx.date, target),
    );
  };

  const allocationsOfMonth = (monthId: string): Allocation[] =>
    state.allocations.filter((a) => a.monthId === monthId);

  const spentCentsFor = (monthId: string, categoryId: string): number => {
    const target = requireMonth(monthId);
    return state.transactions
      .filter(
        (tx) =>
          tx.kind === "EXPENSE" &&
          tx.categoryId === categoryId &&
          sameCalendarMonth(tx.date, target),
      )
      .reduce((sum, tx) => sum - tx.amountCents, 0);
  };

  const cashflowReleasedFor = (monthId: string, categoryId: string): number => {
    // Sinking-fund draws release cash onto the fund's companion category.
    // Static-goal draws are uncoupled from categories: they only move the fund
    // balance and the month's popped-up cashflow.
    const companion = state.categories.find((c) => c.id === categoryId);
    const fundId = companion?.fundId;
    if (!fundId) return 0;
    return state.fundDraws
      .filter((draw) => {
        if (draw.monthId !== monthId || draw.fundId !== fundId) return false;
        return (
          state.funds.find((f) => f.id === draw.fundId)?.kind === "SINKING"
        );
      })
      .reduce((sum, draw) => sum + draw.amountCents, 0);
  };

  const categoryAvailable = (monthId: string): CategoryAvailable[] => {
    requireMonth(monthId);
    return state.categories.map((category) => {
      const assignedCents =
        state.allocations.find(
          (a) => a.monthId === monthId && a.categoryId === category.id,
        )?.assignedCents ?? 0;
      const spentCents = spentCentsFor(monthId, category.id);
      const cashflowReleasedCents = cashflowReleasedFor(monthId, category.id);
      return {
        categoryId: category.id,
        assignedCents,
        spentCents,
        cashflowReleasedCents,
        availableCents: assignedCents - spentCents + cashflowReleasedCents,
      };
    });
  };

  // One derivation shared with the report math (src/engine/pva.ts) so the
  // ledger view and the report can never drift.
  const monthCashflow = (monthId: string) => computeMonthCashflow(state, monthId);

  const accountBalanceCents = (accountId: string): number => {
    const account = requireAccount(accountId);
    const txSum = state.transactions
      .filter((tx) => tx.accountId === accountId)
      .reduce((sum, tx) => sum + tx.amountCents, 0);
    const transferSum = state.transfers.reduce(
      (sum, t) =>
        sum +
        (t.toAccountId === accountId ? t.amountCents : 0) -
        (t.fromAccountId === accountId ? t.amountCents : 0),
      0,
    );
    return account.startingCents + txSum + transferSum;
  };

  // ── planning ops ───────────────────────────────────────────────────────────

  const setAllocation = (
    monthId: string,
    categoryId: string,
    cents: number,
  ): void => {
    const existing = state.allocations.find(
      (a) => a.monthId === monthId && a.categoryId === categoryId,
    );
    if (cents === 0) {
      if (existing)
        state.allocations.splice(state.allocations.indexOf(existing), 1);
      return;
    }
    if (existing) {
      existing.assignedCents = cents;
      return;
    }
    state.allocations.push({ monthId, categoryId, assignedCents: cents });
  };

  const assign = (monthId: string, categoryId: string, cents: number): void => {
    requireMonth(monthId);
    requireCategory(categoryId);
    assertIntegerCents(cents, "cents");
    if (cents < 0) {
      throw new EngineError(
        "NEGATIVE_ASSIGNMENT",
        `assign takes a non-negative amount, got ${cents} — assign 0 to unassign`,
      );
    }
    // Set semantics (one allocation row per month+category, mirroring the
    // @@unique([monthId, categoryId]) constraint): assigning again replaces.
    setAllocation(monthId, categoryId, cents);
  };

  const readyToAssignCents = (monthId: string): number => {
    requireMonth(monthId);
    // Income received (actual income transactions) minus what's already
    // assigned. Fund draws never feed this — they are cashflow, not income.
    const income = transactionsInMonth(monthId)
      .filter((tx) => tx.kind === "INCOME")
      .reduce((sum, tx) => sum + tx.amountCents, 0);
    const assigned = allocationsOfMonth(monthId).reduce(
      (sum, a) => sum + a.assignedCents,
      0,
    );
    return income - assigned;
  };

  const copyPreviousMonth = (monthId: string): void => {
    const target = requireMonth(monthId);
    const prev = previousCalendarMonth(target.year, target.month);
    const prevMonth = state.months.find(
      (m) => m.year === prev.year && m.month === prev.month,
    );
    if (!prevMonth) {
      throw new EngineError(
        "PREVIOUS_MONTH_MISSING",
        `cannot copy: no month exists for ${monthLabel(prev.year, prev.month)}`,
      );
    }
    // "Start from last month, then edit": every non-zero allocation from the
    // previous month lands here; allocations unique to this month survive.
    for (const allocation of allocationsOfMonth(prevMonth.id)) {
      if (allocation.assignedCents === 0) continue;
      setAllocation(monthId, allocation.categoryId, allocation.assignedCents);
    }
  };

  // ── transaction ops ────────────────────────────────────────────────────────

  const assertNoExternalDuplicate = (
    accountId: string,
    externalId: string | undefined,
  ): void => {
    if (
      externalId != null &&
      state.transactions.some(
        (t) => t.accountId === accountId && t.externalId === externalId,
      )
    ) {
      throw new EngineError(
        "DUPLICATE_EXTERNAL_ID",
        `transaction with externalId "${externalId}" already exists on account "${accountId}" — re-imports are idempotent, not re-applied`,
      );
    }
  };

  const recordTransaction = (tx: TransactionInput): CategoryAvailable[] => {
    assertIntegerCents(tx.amountCents, "amountCents");
    if (tx.amountCents === 0)
      throw new EngineError("ZERO_AMOUNT", "amountCents must be non-zero");
    requireAccount(tx.accountId);
    if (tx.kind === "TRANSFER") {
      throw new EngineError(
        "TRANSFER_KIND_UNSUPPORTED",
        "two-account moves go through withdrawToCash/recordTransfer — recordTransaction is for income and categorized spending",
      );
    }
    if (tx.kind === "INCOME" && tx.categoryId != null) {
      throw new EngineError(
        "INCOME_HAS_NO_CATEGORY",
        "income lands in Ready to Assign and has no category",
      );
    }
    if (tx.kind === "EXPENSE") {
      if (tx.categoryId == null)
        throw new EngineError(
          "CATEGORY_REQUIRED",
          "every outflow depletes a category — pass categoryId",
        );
      requireCategory(tx.categoryId);
    }
    assertNoExternalDuplicate(tx.accountId, tx.externalId);
    const date = normalizeDate(tx.date);
    const month = requireMonthByCalendar(date);
    state.transactions.push({
      id: generateId(),
      accountId: tx.accountId,
      categoryId: tx.categoryId,
      fundDrawId: undefined,
      kind: tx.kind,
      amountCents: tx.amountCents,
      date,
      payee: tx.payee,
      note: tx.note,
      externalId: tx.externalId,
      pending: tx.pending ?? false,
      reviewState: tx.reviewState ?? "CONFIRMED",
    });
    return categoryAvailable(month.id);
  };

  const recordTransfer = (input: TransferInput): string => {
    assertPositiveCents(input.amountCents, "amountCents");
    requireAccount(input.fromAccountId);
    requireAccount(input.toAccountId);
    if (input.fromAccountId === input.toAccountId) {
      throw new EngineError(
        "SELF_TRANSFER",
        "a transfer needs two distinct accounts",
      );
    }
    // Date is audit metadata only: transfers never touch categories or month
    // cashflow, so no month row is required to cover it.
    const date = normalizeDate(input.date);
    const id = generateId();
    state.transfers.push({
      id,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amountCents: input.amountCents,
      date,
      payee: input.payee,
    });
    return id;
  };

  const withdrawToCash = (
    accountId: string,
    cents: number,
    date?: string | Date,
  ): string => {
    assertPositiveCents(cents, "cents");
    const source = requireAccount(accountId);
    const cash = state.accounts.find((a) => a.kind === "CASH");
    if (!cash)
      throw new EngineError(
        "NO_CASH_ACCOUNT",
        "no cash wallet account exists for this household",
      );
    if (source.id === cash.id) {
      throw new EngineError(
        "SELF_TRANSFER",
        "cannot withdraw from the cash wallet into itself",
      );
    }
    return recordTransfer({
      fromAccountId: source.id,
      toAccountId: cash.id,
      amountCents: cents,
      date: date ?? new Date(),
      payee: "ATM withdrawal",
    });
  };

  // ── fund ops ───────────────────────────────────────────────────────────────

  const drawFromFund = (fundId: string, expense: TransactionInput): string => {
    const fund = requireFund(fundId);
    if (fund.kind !== "SINKING") {
      throw new EngineError(
        "FUND_KIND_MISMATCH",
        `fund "${fund.name}" is static — drawFromFund pays sinking-fund pop-ups; use drawFromStaticGoal`,
      );
    }
    assertIntegerCents(expense.amountCents, "expense.amountCents");
    if (expense.amountCents >= 0) {
      throw new EngineError(
        "INVALID_EXPENSE_AMOUNT",
        `the pop-up expense is money out — pass a negative amountCents, got ${expense.amountCents}`,
      );
    }
    requireAccount(expense.accountId);
    const companion = state.categories.find((c) => c.fundId === fund.id);
    if (!companion) {
      throw new EngineError(
        "COMPANION_CATEGORY_REQUIRED",
        `fund "${fund.name}" has no companion category to post the expense against`,
      );
    }
    if (expense.categoryId != null && expense.categoryId !== companion.id) {
      throw new EngineError(
        "CATEGORY_MISMATCH",
        `a sinking-fund draw posts against the companion category "${companion.id}", got "${expense.categoryId}"`,
      );
    }
    const date = normalizeDate(expense.date);
    const month = requireMonthByCalendar(date);
    const drawId = generateId();
    const payoutCents = -expense.amountCents;
    state.fundDraws.push({
      id: drawId,
      fundId: fund.id,
      monthId: month.id,
      amountCents: payoutCents,
    });
    fund.balanceCents -= payoutCents;
    state.transactions.push({
      id: generateId(),
      accountId: expense.accountId,
      categoryId: companion.id,
      fundDrawId: drawId,
      kind: "EXPENSE",
      amountCents: expense.amountCents,
      date,
      payee: expense.payee,
      note: expense.note,
      externalId: expense.externalId,
      pending: expense.pending ?? false,
      reviewState: expense.reviewState ?? "CONFIRMED",
    });
    return drawId;
  };

  const drawFromStaticGoal = (
    fundId: string,
    cents: number,
    monthId: string,
  ): string => {
    const fund = requireFund(fundId);
    if (fund.kind !== "STATIC") {
      throw new EngineError(
        "FUND_KIND_MISMATCH",
        `fund "${fund.name}" is sinking — drawFromStaticGoal moves static goals; use drawFromFund for pop-ups`,
      );
    }
    assertPositiveCents(cents, "cents");
    requireMonth(monthId);
    const drawId = generateId();
    state.fundDraws.push({
      id: drawId,
      fundId: fund.id,
      monthId,
      amountCents: cents,
    });
    fund.balanceCents -= cents;
    return drawId;
  };

  // ── danger zone view (D3) ────────────────────────────────────────────────

  const dangerZone = (
    monthId: string,
    options?: DangerZoneOptions,
  ): DangerZoneReport => {
    const month = requireMonth(monthId);
    const appetite: RiskAppetite =
      options?.riskAppetite ?? state.riskAppetite ?? "BALANCED";
    const thresholds = resolveDangerThresholds(options?.thresholds);
    const asOf = { year: month.year, month: month.month };

    // Fund pace first: category rows read their companion fund's verdict.
    const paceByFund = new Map<string, FundPace>();
    const funds: FundDangerState[] = [];
    for (const fund of state.funds) {
      const companion = state.categories.find((c) => c.fundId === fund.id);
      const planned = companion
        ? (state.allocations.find(
            (a) => a.monthId === monthId && a.categoryId === companion.id,
          )?.assignedCents ?? 0)
        : null;
      const pace = computeFundPace(fund, asOf, planned);
      if (!pace) continue;
      paceByFund.set(fund.id, pace);
      funds.push({
        fundId: fund.id,
        state: assessFundPace(pace, appetite, thresholds),
        pace,
      });
    }

    let overall: DangerState = "healthy";
    const categories: DangerCategoryState[] = categoryAvailable(monthId).map(
      (row) => {
        const availability = classifyAvailability(
          row.availableCents,
          row.assignedCents,
          appetite,
          thresholds,
        );
        const fundId = state.categories.find(
          (c) => c.id === row.categoryId,
        )?.fundId;
        const pace = fundId ? paceByFund.get(fundId) : undefined;
        const rowState = pace
          ? worstDangerState(
              availability,
              assessFundPace(pace, appetite, thresholds),
            )
          : availability;
        overall = worstDangerState(overall, rowState);
        return {
          categoryId: row.categoryId,
          state: rowState,
          assignedCents: row.assignedCents,
          availableCents: row.availableCents,
          watchLineCents: watchLineCents(
            row.assignedCents,
            appetite,
            thresholds,
          ),
          fundPace: pace,
        };
      },
    );
    // A standalone fund (no companion category) that blew its deadline is
    // household-level danger even though no category row carries it.
    for (const fund of funds) {
      overall = worstDangerState(overall, fund.state);
    }

    return {
      monthId: month.id,
      riskAppetite: appetite,
      overall,
      categories,
      funds,
    };
  };

  // ── planned-vs-actual view (D9) ──────────────────────────────────────

  const plannedVsActual = (
    monthId: string,
    options?: PvaOptions,
  ): PlannedVsActualReport => buildPlannedVsActual(state, monthId, options);

  const annualSummary = (
    year: number,
    options?: AnnualSummaryOptions,
  ): AnnualSummary => buildAnnualSummary(state, year, options);

  return {
    readyToAssignCents,
    assign,
    copyPreviousMonth,
    recordTransaction,
    withdrawToCash,
    drawFromFund,
    drawFromStaticGoal,
    categoryAvailable,
    monthCashflow,
    accountBalanceCents,
    allocationsOf: allocationsOfMonth,
    fundBalanceCents: (fundId: string): number =>
      requireFund(fundId).balanceCents,
    recordTransfer,
    snapshot: (): EngineState => structuredClone(state),
    dangerZone,
    plannedVsActual,
    annualSummary,
  };
}
