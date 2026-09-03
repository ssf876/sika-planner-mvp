import { describe, expect, it } from "vitest";
import { EngineError } from "@/src/engine/errors";
import { assertIntegerCents, assertPositiveCents, calendarMonth, normalizeDate, previousCalendarMonth } from "@/src/engine/invariants";

describe("assertIntegerCents", () => {
  it.each([
    [0, 0],
    [1, 1],
    [-12500, -12500],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ])("accepts integer value %i", (value, expected) => {
    expect(assertIntegerCents(value, "amountCents")).toBe(expected);
  });

  it.each([[10.5], [-0.01], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "rejects non-integer value %f with NOT_INTEGER_CENTS",
    (value) => {
      expect(() => assertIntegerCents(value, "amountCents")).toThrowError(EngineError);
      expect(() => assertIntegerCents(value, "amountCents")).toThrowError(/integer number of cents/);
      try {
        assertIntegerCents(value, "amountCents");
        expect.unreachable("expected EngineError");
      } catch (error) {
        expect((error as EngineError).code).toBe("NOT_INTEGER_CENTS");
      }
    },
  );
});

describe("assertPositiveCents", () => {
  it("accepts positive integers", () => {
    expect(assertPositiveCents(1, "cents")).toBe(1);
  });

  it.each([[0], [-1]])("rejects non-positive value %i", (value) => {
    expect(() => assertPositiveCents(value, "cents")).toThrowError(EngineError);
    try {
      assertPositiveCents(value, "cents");
      expect.unreachable("expected EngineError");
    } catch (error) {
      expect((error as EngineError).code).toBe("NON_POSITIVE_CENTS");
    }
  });

  it("rejects floats as non-integer first", () => {
    expect(() => assertPositiveCents(0.5, "cents")).toThrowError(/integer number of cents/);
  });
});

describe("calendarMonth", () => {
  it.each([
    ["2026-09-03", 2026, 9],
    ["2026-09-03T18:24:00.000Z", 2026, 9],
    ["2026-01-01", 2026, 1],
    ["2026-12-31", 2026, 12],
  ])("parses %s as year %i month %i", (date, year, month) => {
    expect(calendarMonth(date)).toEqual({ year, month });
  });

  it("uses UTC components for Date objects (household-local dates are built as UTC)", () => {
    expect(calendarMonth(new Date("2026-09-03T00:00:00Z"))).toEqual({ year: 2026, month: 9 });
  });

  it("rejects unparseable date strings", () => {
    expect(() => calendarMonth("not-a-date")).toThrowError(EngineError);
    expect(() => calendarMonth("2026-13-01")).toThrowError(/out-of-range month/);
  });
});

describe("normalizeDate", () => {
  it("keeps the calendar day of date-only strings", () => {
    expect(normalizeDate("2026-09-03")).toBe("2026-09-03");
  });

  it("trims Date objects to YYYY-MM-DD", () => {
    expect(normalizeDate(new Date("2026-09-03T23:59:59Z"))).toBe("2026-09-03");
  });

  it("rejects unparseable strings", () => {
    expect(() => normalizeDate("09/03/2026")).toThrowError(EngineError);
  });
});

describe("previousCalendarMonth", () => {
  it.each([
    [2026, 9, 2026, 8],
    [2026, 1, 2025, 12],
    [2027, 1, 2026, 12],
  ])("rolls %i-%i back to %i-%i", (year, month, expectedYear, expectedMonth) => {
    expect(previousCalendarMonth(year, month)).toEqual({ year: expectedYear, month: expectedMonth });
  });
});
