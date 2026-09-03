/**
 * Typed failures from the repository layer. Callers branch on `code`, never
 * on message text; the message is safe to show as-is.
 */

export type RepositoryErrorCode =
  | "NOT_FOUND"
  | "INVALID_NAME"
  | "ACCOUNT_IN_USE";

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string) {
    super(message);
    this.name = "RepositoryError";
    this.code = code;
  }
}

const ENGINE_ERROR_MESSAGES: Record<string, string> = {
  CATEGORY_REQUIRED: "Pick a category — every expense needs one.",
  INCOME_HAS_NO_CATEGORY: "Income isn't categorized — it lands in Ready to Assign.",
  ZERO_AMOUNT: "Enter a non-zero amount.",
  NON_POSITIVE_CENTS: "Enter an amount greater than zero.",
  NOT_INTEGER_CENTS: "Enter a valid dollar amount.",
  SELF_TRANSFER: "Pick two different accounts.",
  UNKNOWN_ACCOUNT: "That account doesn't exist for your household.",
  UNKNOWN_CATEGORY: "That category doesn't exist for your household.",
  UNKNOWN_MONTH: "No budget month covers that date.",
  PREVIOUS_MONTH_MISSING:
    "There's no previous month to copy — this planner starts fresh.",
  NO_CASH_ACCOUNT: "Add a cash wallet account first.",
  INVALID_DATE: "Enter a valid date.",
};

/**
 * A user-safe message for engine failures, or null when the error isn't an
 * EngineError (never swallow non-domain errors — rethrow those).
 */
export function engineErrorMessage(error: unknown): string | null {
  if (
    error instanceof Error &&
    error.name === "EngineError" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return ENGINE_ERROR_MESSAGES[error.code] ?? "That didn't add up — check the details and try again.";
  }
  return null;
}
