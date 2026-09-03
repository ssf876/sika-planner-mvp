// Public surface of the budget engine (D2). The app imports from here only.
export { createBudgetEngine, type EngineDeps } from "./engine";
export { EngineError, type EngineErrorCode } from "./errors";
export {
  assertIntegerCents,
  assertPositiveCents,
  calendarMonth,
  normalizeDate,
  previousCalendarMonth,
} from "./invariants";
export type {
  Account,
  AccountKind,
  Allocation,
  BudgetEngine,
  BudgetEngineRuntime,
  BudgetMonth,
  Category,
  CategoryAvailable,
  CategoryGroup,
  EngineState,
  Fund,
  FundDraw,
  FundKind,
  MonthCashflow,
  ReviewState,
  Transaction,
  TransactionInput,
  Transfer,
  TransferInput,
  TxKind,
} from "./types";
