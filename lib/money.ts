/**
 * Money is Int cents everywhere in Sika Planner (spec A1: single currency USD,
 * integer cents, never floats). All display formatting funnels through here so
 * the "Int cents" rule has exactly one place where cents become strings.
 */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`Money must be integer cents, received: ${cents}`);
  }

  const sign = cents < 0 ? "-" : "";
  const absCents = Math.abs(cents);
  const dollars = Math.floor(absCents / 100);
  const remainder = absCents % 100;

  return `${sign}$${dollars.toLocaleString("en-US")}.${remainder
    .toString()
    .padStart(2, "0")}`;
}
