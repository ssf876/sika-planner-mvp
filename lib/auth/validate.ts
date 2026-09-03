/**
 * Pure input validation for auth and onboarding forms — no I/O, fully
 * unit-testable. All money parsing lands as integer cents (spec A1).
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    return "Enter a valid email address.";
  }
  return null;
}

export const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * Parse an income amount like "5,000", "2500.50", or "$1200" into integer
 * cents. Returns null when the input is not a non-negative dollar amount.
 */
export function parseIncomeToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const cents = Math.round(Number(cleaned) * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}
