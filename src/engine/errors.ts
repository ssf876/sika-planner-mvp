// Typed engine failures. Callers branch on `code`, never on message text.

export type EngineErrorCode =
  | "NOT_INTEGER_CENTS"
  | "NON_POSITIVE_CENTS"
  | "NEGATIVE_ASSIGNMENT"
  | "ZERO_AMOUNT"
  | "UNKNOWN_MONTH"
  | "UNKNOWN_CATEGORY"
  | "UNKNOWN_ACCOUNT"
  | "UNKNOWN_FUND"
  | "FUND_KIND_MISMATCH"
  | "COMPANION_CATEGORY_REQUIRED"
  | "CATEGORY_MISMATCH"
  | "CATEGORY_REQUIRED"
  | "INCOME_HAS_NO_CATEGORY"
  | "TRANSFER_KIND_UNSUPPORTED"
  | "DUPLICATE_EXTERNAL_ID"
  | "INVALID_EXPENSE_AMOUNT"
  | "NO_CASH_ACCOUNT"
  | "SELF_TRANSFER"
  | "PREVIOUS_MONTH_MISSING"
  | "INVALID_DATE"
  | "INVALID_DANGER_THRESHOLD";

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}
