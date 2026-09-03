import { describe, expect, it } from "vitest";

import {
  AUTO_ACCEPT_CONFIDENCE,
  EXACT_MATCH_CONFIDENCE,
  KEYWORD_MATCH_MAX_CONFIDENCE,
  createCategorizer,
} from "@/src/categorizer";
import type { ConfirmedCategorization } from "@/src/categorizer";

const GROCERIES = "cat-groceries";
const DINING_OUT = "cat-dining-out";
const TRANSPORT = "cat-transport";

function history(...rows: ConfirmedCategorization[]): ConfirmedCategorization[] {
  return rows;
}

describe("categorizer — exact-payee match", () => {
  it("returns null with no history", () => {
    const categorizer = createCategorizer([]);
    expect(categorizer.suggest({ payee: "Whole Foods" })).toBeNull();
  });

  it("returns null for a blank payee", () => {
    const categorizer = createCategorizer(
      history({ payee: "Whole Foods", categoryId: GROCERIES, date: "2026-09-01" }),
    );
    expect(categorizer.suggest({ payee: "" })).toBeNull();
    expect(categorizer.suggest({ payee: "   " })).toBeNull();
  });

  it("suggests the confirmed category for an identical payee at confidence 1", () => {
    const categorizer = createCategorizer(
      history({ payee: "Whole Foods", categoryId: GROCERIES, date: "2026-09-01" }),
    );
    expect(categorizer.suggest({ payee: "Whole Foods" })).toEqual({
      categoryId: GROCERIES,
      confidence: EXACT_MATCH_CONFIDENCE,
    });
  });

  it("picks the most recent category when a payee was confirmed twice", () => {
    // Spec: exact-payee match → most recent confirmed category.
    const categorizer = createCategorizer(
      history(
        { payee: "Corner Cafe", categoryId: GROCERIES, date: "2026-08-01" },
        { payee: "Corner Cafe", categoryId: DINING_OUT, date: "2026-09-02" },
      ),
    );
    expect(categorizer.suggest({ payee: "Corner Cafe" })?.categoryId).toBe(
      DINING_OUT,
    );
  });

  it("normalizes case, punctuation, and whitespace before matching", () => {
    const categorizer = createCategorizer(
      history({
        payee: "Whole Foods, Inc.",
        categoryId: GROCERIES,
        date: "2026-09-01",
      }),
    );
    expect(categorizer.suggest({ payee: "WHOLE FOODS INC" })?.confidence).toBe(
      EXACT_MATCH_CONFIDENCE,
    );
    expect(categorizer.suggest({ payee: "  whole   foods inc. " })).toEqual({
      categoryId: GROCERIES,
      confidence: EXACT_MATCH_CONFIDENCE,
    });
  });

  it("accepts a full FeedTransaction structurally (spec contract)", () => {
    const categorizer = createCategorizer(
      history({ payee: "Whole Foods", categoryId: GROCERIES, date: "2026-09-01" }),
    );
    const feedRow = {
      externalId: "TXN-1",
      date: "2026-09-03",
      payee: "Whole Foods",
      amountCents: -8640,
      pending: false,
      raw: {},
    };
    // A FeedTransaction carries more fields; the learner consumes the payee.
    expect(categorizer.suggest(feedRow)?.categoryId).toBe(GROCERIES);
  });
});

describe("categorizer — keyword/token match", () => {
  it("suggests the category with the most token evidence", () => {
    const categorizer = createCategorizer(
      history(
        { payee: "Whole Foods", categoryId: GROCERIES, date: "2026-09-01" },
        { payee: "Market Street Cafe", categoryId: DINING_OUT, date: "2026-09-02" },
      ),
    );
    // Not an exact history payee: "whole" and "foods" vote Groceries,
    // "market" votes Dining Out — two votes beat one.
    const suggestion = categorizer.suggest({ payee: "Whole Foods Market" });
    expect(suggestion?.categoryId).toBe(GROCERIES);
    expect(suggestion?.confidence).toBeCloseTo(
      (KEYWORD_MATCH_MAX_CONFIDENCE * 2) / 3,
    );
  });

  it("caps keyword confidence below the auto-accept line", () => {
    const categorizer = createCategorizer(
      history({
        payee: "Whole Foods Market",
        categoryId: GROCERIES,
        date: "2026-09-01",
      }),
    );
    // Every token with history agrees (and the payee itself is not in
    // history) — still partial evidence, never auto-acceptable.
    const suggestion = categorizer.suggest({ payee: "Foods Market" });
    expect(suggestion?.confidence).toBe(KEYWORD_MATCH_MAX_CONFIDENCE);
    expect(suggestion?.confidence).toBeLessThanOrEqual(AUTO_ACCEPT_CONFIDENCE);
  });

  it("counts only tokens with history against the confidence denominator", () => {
    const categorizer = createCategorizer(
      history({ payee: "Shell", categoryId: TRANSPORT, date: "2026-09-01" }),
    );
    // One of three tokens has evidence → 0.8 / 3.
    const suggestion = categorizer.suggest({ payee: "Shell Station 42" });
    expect(suggestion?.categoryId).toBe(TRANSPORT);
    expect(suggestion?.confidence).toBeCloseTo(KEYWORD_MATCH_MAX_CONFIDENCE / 3);
  });

  it("breaks token ties by the most recent confirmation", () => {
    const categorizer = createCategorizer(
      history(
        { payee: "Blue Bottle", categoryId: DINING_OUT, date: "2026-09-01" },
        { payee: "Blue Bottle", categoryId: GROCERIES, date: "2026-09-02" },
      ),
    );
    // Both categories have one "blue" confirmation; the newer one wins.
    expect(categorizer.suggest({ payee: "Blue Bottle Cafe" })?.categoryId).toBe(
      GROCERIES,
    );
  });

  it("returns null when no token has any history", () => {
    const categorizer = createCategorizer(
      history({ payee: "Whole Foods", categoryId: GROCERIES, date: "2026-09-01" }),
    );
    expect(categorizer.suggest({ payee: "Shell Station" })).toBeNull();
  });
});

describe("categorizer — learn", () => {
  it("makes the next identical payee an exact match", () => {
    const categorizer = createCategorizer([]);
    categorizer.learn({ payee: "Blue Bottle Coffee", categoryId: DINING_OUT });
    expect(categorizer.suggest({ payee: "Blue Bottle Coffee" })).toEqual({
      categoryId: DINING_OUT,
      confidence: EXACT_MATCH_CONFIDENCE,
    });
  });

  it("feeds the confirm-edit-learns loop: learn overrides older evidence", () => {
    const categorizer = createCategorizer(
      history({ payee: "Whole Foods", categoryId: GROCERIES, date: "2026-09-01" }),
    );
    // The user edits a "Whole Foods" row to Dining Out and confirms — learn
    // records it, and the next suggestion follows the human, not the keyword.
    categorizer.learn({ payee: "Whole Foods", categoryId: DINING_OUT });
    expect(categorizer.suggest({ payee: "Whole Foods" })).toEqual({
      categoryId: DINING_OUT,
      confidence: EXACT_MATCH_CONFIDENCE,
    });
  });

  it("rejects blank categorizations instead of recording them", () => {
    const categorizer = createCategorizer([]);
    expect(() => categorizer.learn({ payee: "  ", categoryId: GROCERIES })).toThrow(
      /payee/,
    );
    expect(() => categorizer.learn({ payee: "Whole Foods", categoryId: "" })).toThrow(
      /categoryId/,
    );
  });
});
