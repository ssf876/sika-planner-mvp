// Pure validation + calendar helpers. No engine state, no side effects —
// every money value entering the engine passes through these first.

import { EngineError } from "./errors";

/** Money is integer cents everywhere (spec A1). Floats are a data-corruption bug, not a rounding question. */
export function assertIntegerCents(value: number, field: string): number {
  if (!Number.isInteger(value)) {
    throw new EngineError("NOT_INTEGER_CENTS", `${field} must be an integer number of cents, got ${value}`);
  }
  return value;
}

export function assertPositiveCents(value: number, field: string): number {
  assertIntegerCents(value, field);
  if (value <= 0) {
    throw new EngineError("NON_POSITIVE_CENTS", `${field} must be positive, got ${value}`);
  }
  return value;
}

/**
 * Resolves a date to its calendar (year, month 1–12).
 *
 * Household-local convention (spec A4): date-only strings ("YYYY-MM-DD") are
 * parsed as UTC calendar dates so the calendar day is preserved exactly;
 * full ISO timestamps and Date objects use their UTC components.
 */
export function calendarMonth(date: string | Date): { year: number; month: number } {
  if (date instanceof Date) {
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}/.exec(date);
  if (!dateOnly) {
    throw new EngineError("INVALID_DATE", `date must be a Date or ISO string, got "${date}"`);
  }
  const [year, month] = date.slice(0, 10).split("-").map(Number);
  if (month < 1 || month > 12) {
    throw new EngineError("INVALID_DATE", `date has out-of-range month: "${date}"`);
  }
  return { year, month };
}

/** Normalizes a date input to an ISO "YYYY-MM-DD" string (engine state shape). */
export function normalizeDate(date: string | Date): string {
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) {
    throw new EngineError("INVALID_DATE", `date must be a Date or ISO string, got "${date}"`);
  }
  return date.slice(0, 10);
}

/** Previous calendar month, rolling January back to December of the prior year. */
export function previousCalendarMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}
