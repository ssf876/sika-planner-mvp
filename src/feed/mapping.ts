// CSV → FeedTransaction mapping (D4). Pure and isomorphic: the browser runs
// it for the mapping preview, the server re-runs it at import time, so the
// summary the user approved is the summary they get.
//
// The generic export format is the v1 fixture basis (open question Q2 names
// the first real bank). Amounts are US-export style — optional $, thousands
// commas, 1–2 decimals, accounting negatives in parentheses; anything else is
// reported as malformed rather than silently mis-parsed. Money never touches
// a float: dollars and cents convert through integer math.

import { parseCsv } from "./csv";
import type { CsvColumnMapping, FeedTransaction, MalformedRow } from "./types";

export interface MappedFeed {
  transactions: FeedTransaction[];
  /** Rows that could not be imported, ordered by row number. */
  malformed: MalformedRow[];
  /** Rows whose externalId repeats an earlier row in the same file. */
  duplicates: MalformedRow[];
}

/** Case-insensitive cell values that mean "still pending". */
export const DEFAULT_PENDING_MARKERS = ["pending", "true", "yes", "y", "1"];

/**
 * Signed integer cents from a bank-export amount cell, or null when the cell
 * is not a parseable amount. Accepted shapes: `1234.56`, `$1,234.56`,
 * `-$45`, `(45.00)` (accounting negative). More than two decimal places is
 * rejected — rounding money is never the parser's call to make.
 */
export function parseAmountToCents(input: string): number | null {
  let s = input.trim().replace(/\s|\$/g, "");
  if (s === "") return null;

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-") || s.startsWith("+")) {
    negative = s.startsWith("-");
    s = s.slice(1);
  }
  if (s === "") return null;

  // 1234.56 | 1,234.56 | 12 | 12.5
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(s)) return null;

  const [dollars, decimals = ""] = s.split(".");
  const centsFromDecimals = Number((decimals + "00").slice(0, 2));
  const cents = Number(dollars.replaceAll(",", "")) * 100 + centsFromDecimals;
  return negative ? -cents : cents;
}

/**
 * Normalize a bank-export date cell to household-local ISO "YYYY-MM-DD"
 * (spec A4). Accepts ISO and the US `M/D/YYYY` style most US bank exports
 * use; rejects impossible calendar dates rather than guessing.
 */
export function parseCalendarDate(input: string): string | null {
  const s = input.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return sameCalendarDate(iso[1], iso[2], iso[3]);

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) {
    const [, month, day, year] = us;
    return sameCalendarDate(year, month.padStart(2, "0"), day.padStart(2, "0"));
  }

  return null;
}

function sameCalendarDate(
  year: string,
  month: string,
  day: string,
): string | null {
  const resolved = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  // Date.UTC rolls 2026-02-30 into March — require the round-trip to agree.
  return Number.isNaN(resolved.getTime()) ||
    resolved.getUTCFullYear() !== Number(year) ||
    resolved.getUTCMonth() + 1 !== Number(month) ||
    resolved.getUTCDate() !== Number(day)
    ? null
    : `${year}-${month}-${day}`;
}

/**
 * Stable dedupe key for exports without a transaction-id column: identical
 * row content derives an identical key, so re-uploading the same file stays
 * idempotent (accountId + externalId unique). The cost — two genuinely
 * identical same-day rows collapse to the first — is the honest trade for a
 * content key; banks that provide ids map the externalId column instead.
 */
export function deriveExternalId(tx: {
  date: string;
  payee: string;
  amountCents: number;
}): string {
  return `${tx.date}|${tx.payee}|${tx.amountCents}`;
}

function cell(row: string[], index: number | undefined): string {
  return index === undefined || index >= row.length ? "" : row[index];
}

/**
 * Map an uploaded CSV onto FeedTransactions.
 *
 * Valid rows import; broken rows are reported, never silently dropped:
 * `malformed` carries the file row number (header included) and a reason;
 * `duplicates` flags in-file externalId repeats for the preview. The importer
 * re-checks duplicates against the database — preview and import agree
 * because both key on externalId.
 */
export function applyCsvMapping(
  csvText: string,
  mapping: CsvColumnMapping,
): MappedFeed {
  let rows: string[][];
  try {
    rows = parseCsv(csvText);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "the file could not be parsed";
    return { transactions: [], malformed: [{ row: 1, reason }], duplicates: [] };
  }

  if (rows.length === 0) {
    return {
      transactions: [],
      malformed: [{ row: 1, reason: "the file is empty" }],
      duplicates: [],
    };
  }

  const headers = rows[0].map((header) => header.trim());
  const indexOf = new Map<string, number>();
  // First occurrence wins on duplicate headers; raw keeps every column.
  headers.forEach((header, index) => {
    if (!indexOf.has(header)) indexOf.set(header, index);
  });

  const required = ["date", "payee", "amount"] as const;
  const missing = required.filter((field) => !indexOf.has(mapping[field]));
  if (missing.length > 0) {
    return {
      transactions: [],
      malformed: missing.map((field) => ({
        row: 1,
        reason: `the mapping references "${mapping[field]}", which is not a column in this file`,
      })),
      duplicates: [],
    };
  }

  const indexes = {
    date: indexOf.get(mapping.date)!,
    payee: indexOf.get(mapping.payee)!,
    amount: indexOf.get(mapping.amount)!,
    memo: mapping.memo ? indexOf.get(mapping.memo) : undefined,
    externalId: mapping.externalId
      ? indexOf.get(mapping.externalId)
      : undefined,
    pending: mapping.pending ? indexOf.get(mapping.pending) : undefined,
  } as const;

  const markers = (mapping.pendingMarkers ?? DEFAULT_PENDING_MARKERS).map(
    (marker) => marker.toLowerCase(),
  );

  const transactions: FeedTransaction[] = [];
  const malformed: MalformedRow[] = [];
  const duplicates: MalformedRow[] = [];
  const seenExternalIds = new Map<string, number>();

  // Data rows start at file row 2 (row 1 is the header).
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;

    // Trailing newlines export as all-empty rows — not an error, skip them.
    if (row.every((value) => value.trim() === "")) continue;

    const amountCents = parseAmountToCents(cell(row, indexes.amount));
    if (amountCents === null) {
      malformed.push({
        row: rowNumber,
        reason: `amount "${cell(row, indexes.amount).trim()}" is not a number`,
      });
      continue;
    }
    if (amountCents === 0) {
      malformed.push({
        row: rowNumber,
        reason: "amount is zero — transactions must move money",
      });
      continue;
    }

    const date = parseCalendarDate(cell(row, indexes.date));
    if (date === null) {
      malformed.push({
        row: rowNumber,
        reason: `date "${cell(row, indexes.date).trim()}" is not a valid date (use YYYY-MM-DD or M/D/YYYY)`,
      });
      continue;
    }

    const payee = cell(row, indexes.payee).trim();
    if (payee === "") {
      malformed.push({ row: rowNumber, reason: "payee is missing" });
      continue;
    }

    const mappedExternalId = cell(row, indexes.externalId).trim();
    const externalId =
      mappedExternalId || deriveExternalId({ date, payee, amountCents });

    const previousRow = seenExternalIds.get(externalId);
    if (previousRow !== undefined) {
      duplicates.push({
        row: rowNumber,
        reason: `duplicate of row ${previousRow} (same ${mappedExternalId ? "transaction id" : "date, payee, and amount"})`,
      });
      continue;
    }
    seenExternalIds.set(externalId, rowNumber);

    const pendingCell = cell(row, indexes.pending).trim().toLowerCase();
    const memo = cell(row, indexes.memo).trim();

    transactions.push({
      externalId,
      date,
      payee,
      amountCents,
      pending:
        indexes.pending !== undefined && pendingCell !== ""
          ? markers.includes(pendingCell)
          : false,
      memo: memo === "" ? undefined : memo,
      raw: Object.fromEntries(headers.map((h, idx) => [h, row[idx] ?? ""])),
    });
  }

  return { transactions, malformed, duplicates };
}

const SUGGESTIONS: {
  field: "date" | "payee" | "amount" | "memo" | "externalId" | "pending";
  pattern: RegExp;
}[] = [
  { field: "date", pattern: /date/i },
  { field: "payee", pattern: /^(?:payee|name|description|merchant|details)/i },
  { field: "amount", pattern: /amount|value/i },
  { field: "memo", pattern: /memo|note/i },
  {
    field: "externalId",
    pattern: /(?:transaction|trans\.?|ref(?:erence)?)\s*id|reference/i,
  },
  { field: "pending", pattern: /pending|status/i },
];

/**
 * Best-effort initial mapping from a header row — pre-fills the UI's selects
 * (generic-export headers all match). First match wins; the user corrects.
 */
export function suggestMapping(headers: string[]): Partial<CsvColumnMapping> {
  const suggested: Partial<CsvColumnMapping> = {};
  for (const { field, pattern } of SUGGESTIONS) {
    const header = headers.find((header_) => pattern.test(header_));
    if (header !== undefined) suggested[field] = header;
  }
  return suggested;
}
