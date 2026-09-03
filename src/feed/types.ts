// Feed domain types — pure TypeScript, zero DB or framework imports.
//
// The spec locks manual entry + CSV import behind one pluggable AccountFeed
// interface (Locked · Feeds): "real bank sync (e.g. Plaid) is a later adapter,
// not a v1 blocker." The importer depends on this contract only, so a future
// bank adapter slots in without touching persistence or UI.
//
// Money is Int cents everywhere (spec A1); dates are household-local ISO
// "YYYY-MM-DD" calendar dates (spec A4).

/** The account a feed imports into. */
export interface AccountRef {
  accountId: string;
}

/** One normalized transaction a feed hands to the importer. */
export interface FeedTransaction {
  /** Dedupe key — Transaction rows are unique per (accountId, externalId). */
  externalId: string;
  /** Bank-local ISO date ("YYYY-MM-DD"). */
  date: string;
  payee: string;
  /** Signed; positive = money in. */
  amountCents: number;
  /** True while the bank still shows the row as authorized, not settled. */
  pending: boolean;
  /** Optional memo from the export, kept as the row's note. */
  memo?: string;
  /** Every column of the source row, kept for audit. */
  raw: Record<string, string>;
}

/**
 * A source of transactions for an account. "csv" in v1; "plaid" is a future
 * adapter implementing the same shape.
 */
export interface AccountFeed {
  readonly kind: string;
  listNew(account: AccountRef, since?: Date): Promise<FeedTransaction[]>;
}

/**
 * How one bank export's columns map onto FeedTransaction fields. Saved per
 * export format (per bank / export type, open question Q2) so re-uploads skip
 * mapping. Values are exact column headers from the export's header row.
 */
export interface CsvColumnMapping {
  date: string;
  payee: string;
  amount: string;
  memo?: string;
  /**
   * Column carrying the bank's own transaction id. When absent, a stable key
   * is derived from row content — re-imports of the same file stay idempotent.
   */
  externalId?: string;
  /** Column spelling out settlement state ("pending" vs "posted"). */
  pending?: string;
  /** Case-insensitive cell values that mean "still pending". */
  pendingMarkers?: string[];
}

/** A row that could not be imported, with where and why. */
export interface MalformedRow {
  /**
   * 1-based row number in the file, header included — the number the user's
   * spreadsheet shows.
   */
  row: number;
  reason: string;
}
