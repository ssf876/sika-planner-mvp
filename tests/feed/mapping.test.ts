import { describe, expect, it } from "vitest";

import {
  DEFAULT_PENDING_MARKERS,
  applyCsvMapping,
  deriveExternalId,
  parseAmountToCents,
  parseCalendarDate,
  suggestMapping,
} from "@/src/feed/mapping";
import type { CsvColumnMapping } from "@/src/feed/types";

const genericMapping: CsvColumnMapping = {
  date: "Date",
  payee: "Description",
  amount: "Amount",
  memo: "Memo",
  externalId: "Transaction ID",
  pending: "Status",
};

function map(csvText: string, mapping: CsvColumnMapping = genericMapping) {
  return applyCsvMapping(csvText, mapping);
}

describe("parseAmountToCents", () => {
  it.each([
    ["1234.56", 123456],
    ["-86.40", -8640],
    ["+$18.50", 1850],
    ["$18.50", 1850],
    ["1,234.56", 123456],
    ["-$1,234.56", -123456],
    ["(45.00)", -4500],
    // Parens mean negative; a stray minus inside is still negative.
    ["(-45.00)", -4500],
    ["  -4.95 ", -495],
    ["12.5", 1250],
    ["0.01", 1],
    ["2500", 250000],
  ])("parses %s to %i cents", (cell, expected) => {
    expect(parseAmountToCents(cell)).toBe(expected);
  });

  it.each([
    [""],
    ["   "],
    ["not-a-number"],
    ["1.234"],
    ["$"],
    ["1.234.56"],
  ])("rejects %s", (cell) => {
    expect(parseAmountToCents(cell)).toBeNull();
  });
});

describe("parseCalendarDate", () => {
  it.each([
    ["2026-09-01", "2026-09-01"],
    [" 2026-09-01 ", "2026-09-01"],
    ["9/1/2026", "2026-09-01"],
    ["09/04/2026", "2026-09-04"],
    ["12/31/1999", "1999-12-31"],
  ])("normalizes %s to %s", (cell, expected) => {
    expect(parseCalendarDate(cell)).toBe(expected);
  });

  it.each([
    [""],
    ["2026-13-40"],
    ["2026-02-30"],
    ["09/31/2026"],
    ["31/09/2026"],
    ["Sept 4, 2026"],
    ["09-04-2026"],
  ])("rejects %s", (cell) => {
    expect(parseCalendarDate(cell)).toBeNull();
  });
});

describe("deriveExternalId", () => {
  it("is stable for identical row content", () => {
    const row = { date: "2026-09-01", payee: "Coffee", amountCents: -495 };
    expect(deriveExternalId(row)).toBe(deriveExternalId({ ...row }));
  });

  it("distinguishes rows that differ in any field", () => {
    const base = { date: "2026-09-01", payee: "Coffee", amountCents: -495 };
    const keys = [
      base,
      { ...base, amountCents: -490 },
      { ...base, payee: "Coffee Shop" },
      { ...base, date: "2026-09-02" },
    ].map(deriveExternalId);
    expect(new Set(keys).size).toBe(4);
  });
});

describe("applyCsvMapping", () => {
  const header = "Transaction ID,Date,Description,Amount,Memo,Status";

  it("maps valid rows into feed transactions", () => {
    const { transactions, malformed, duplicates } = map(
      `${header}\nTXN-1,2026-09-01,Whole Foods,-86.40,Groceries,POSTED`,
    );
    expect(malformed).toEqual([]);
    expect(duplicates).toEqual([]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      externalId: "TXN-1",
      date: "2026-09-01",
      payee: "Whole Foods",
      amountCents: -8640,
      pending: false,
      memo: "Groceries",
    });
    // Every source column is preserved for audit, mapped or not.
    expect(transactions[0].raw).toEqual({
      "Transaction ID": "TXN-1",
      Date: "2026-09-01",
      Description: "Whole Foods",
      Amount: "-86.40",
      Memo: "Groceries",
      Status: "POSTED",
    });
  });

  it("parses quoted fields: commas in payees, quoted amounts", () => {
    const { transactions } = map(
      `${header}\nTXN-2,2026-09-03,"City Metro, Downtown","-42.75",,PENDING`,
    );
    expect(transactions[0].payee).toBe("City Metro, Downtown");
    expect(transactions[0].amountCents).toBe(-4275);
  });

  it("marks pending rows using the mapping's markers", () => {
    const pendingFor = (status: string) =>
      map(`${header}\nTXN-1,2026-09-01,Coffee,-4.00,,${status}`)
        .transactions[0].pending;

    for (const marker of DEFAULT_PENDING_MARKERS) {
      expect(pendingFor(marker.toUpperCase())).toBe(true);
    }
    expect(pendingFor("POSTED")).toBe(false);
    expect(pendingFor("")).toBe(false);
  });

  it("normalizes US dates and strips dollar signs", () => {
    const { transactions } = map(
      `${header}\nTXN-3,09/04/2026,Cinema,$18.50,,POSTED`,
    );
    expect(transactions[0].date).toBe("2026-09-04");
    expect(transactions[0].amountCents).toBe(1850);
  });

  it("reports malformed rows with file row numbers (header included)", () => {
    const csv = [
      header,
      "TXN-6,2026-09-05,Bakery,not-a-number,,POSTED", // row 2: bad amount
      "TXN-7,2026-13-40,Ghost,-10.00,,POSTED", // row 3: impossible date
      "TXN-8,2026-09-07,,-3.25,,POSTED", // row 4: missing payee
      "TXN-9,2026-09-08,Zero,0.00,,POSTED", // row 5: zero amount
    ].join("\n");

    const { transactions, malformed } = map(csv);
    expect(transactions).toEqual([]);
    expect(malformed).toEqual([
      { row: 2, reason: expect.stringContaining("not a number") },
      { row: 3, reason: expect.stringContaining("not a valid date") },
      { row: 4, reason: expect.stringContaining("payee is missing") },
      { row: 5, reason: expect.stringContaining("amount is zero") },
    ]);
  });

  it("imports the valid rows around malformed ones", () => {
    const csv = [
      header,
      "TXN-6,2026-09-05,Bakery,not-a-number,,POSTED",
      "TXN-1,2026-09-01,Whole Foods,-86.40,,POSTED",
    ].join("\n");

    const { transactions, malformed } = map(csv);
    expect(malformed).toHaveLength(1);
    expect(transactions.map((tx) => tx.externalId)).toEqual(["TXN-1"]);
  });

  it("flags in-file externalId duplicates and drops the later row", () => {
    const csv = [
      header,
      "TXN-2,2026-09-02,Payroll,2500.00,,POSTED",
      "TXN-2,2026-09-02,Payroll,2500.00,,POSTED",
    ].join("\n");

    const { transactions, duplicates } = map(csv);
    expect(transactions).toHaveLength(1);
    expect(duplicates).toEqual([
      { row: 3, reason: expect.stringContaining("duplicate of row 2") },
    ]);
  });

  it("derives stable externalIds when no id column is mapped", () => {
    const contentMapping: CsvColumnMapping = {
      date: "Date",
      payee: "Description",
      amount: "Amount",
    };
    const csv = "Date,Description,Amount\n2026-09-01,Whole Foods,-86.40";

    const first = map(csv, contentMapping);
    const second = map(csv, contentMapping);

    expect(first.transactions[0].externalId).toBe(
      deriveExternalId({
        date: "2026-09-01",
        payee: "Whole Foods",
        amountCents: -8640,
      }),
    );
    expect(second.transactions[0].externalId).toBe(
      first.transactions[0].externalId,
    );
  });

  it("flags content-duplicate rows when ids are derived", () => {
    const mapping: CsvColumnMapping = {
      date: "Date",
      payee: "Description",
      amount: "Amount",
    };
    const csv =
      "Date,Description,Amount\n2026-09-01,Coffee,-4.00\n2026-09-01,Coffee,-4.00";

    const { transactions, duplicates } = map(csv, mapping);
    expect(transactions).toHaveLength(1);
    expect(duplicates[0].reason).toContain("date, payee, and amount");
  });

  it("skips blank rows silently", () => {
    const { transactions, malformed } = map(
      `${header}\nTXN-1,2026-09-01,Coffee,-4.00,,POSTED\n,,,,,\n`,
    );
    expect(malformed).toEqual([]);
    expect(transactions).toHaveLength(1);
  });

  it("reports a mapping that references a missing column", () => {
    const { transactions, malformed } = map(
      `${header}\nTXN-1,2026-09-01,Coffee,-4.00,,POSTED`,
      { ...genericMapping, amount: "Total" },
    );
    expect(transactions).toEqual([]);
    expect(malformed).toEqual([
      { row: 1, reason: expect.stringContaining('"Total"') },
    ]);
  });

  it("reports an empty file and structural parse errors", () => {
    expect(map("")).toEqual({
      transactions: [],
      malformed: [{ row: 1, reason: "the file is empty" }],
      duplicates: [],
    });

    const unclosed = map(`${header}\nTXN-1,2026-09-01,"Coffee,-4.00,,POSTED`);
    expect(unclosed.transactions).toEqual([]);
    expect(unclosed.malformed[0].reason).toContain("Unclosed quoted field");
  });
});

describe("suggestMapping", () => {
  it("pre-fills from generic-export headers", () => {
    const suggested = suggestMapping([
      "Transaction ID",
      "Date",
      "Description",
      "Amount",
      "Memo",
      "Status",
    ]);
    expect(suggested).toEqual({
      date: "Date",
      payee: "Description",
      amount: "Amount",
      memo: "Memo",
      externalId: "Transaction ID",
      pending: "Status",
    });
  });

  it("leaves fields unsuggested when no header matches", () => {
    expect(suggestMapping(["Col A", "Col B"])).toEqual({});
  });
});
