import { describe, expect, it } from "vitest";

import { parsePlannerProposal } from "@/lib/planner/proposals";

describe("parsePlannerProposal — the advisor seam's trust boundary", () => {
  it("accepts a well-formed proposal", () => {
    expect(
      parsePlannerProposal({
        id: "prop-1",
        categoryId: "cat-1",
        suggestedCents: 7500,
        reason: "Back-to-school season",
      }),
    ).toEqual({
      id: "prop-1",
      categoryId: "cat-1",
      suggestedCents: 7500,
      reason: "Back-to-school season",
    });
  });

  it("accepts a zero-cent suggestion and an empty reason", () => {
    expect(
      parsePlannerProposal({
        id: "prop-2",
        categoryId: "cat-1",
        suggestedCents: 0,
        reason: "",
      }),
    ).toEqual({
      id: "prop-2",
      categoryId: "cat-1",
      suggestedCents: 0,
      reason: undefined,
    });
  });

  it("rejects non-objects and missing fields", () => {
    expect(parsePlannerProposal(null)).toBeNull();
    expect(parsePlannerProposal("prop-1")).toBeNull();
    expect(
      parsePlannerProposal({ categoryId: "cat-1", suggestedCents: 1 }),
    ).toBeNull();
    expect(
      parsePlannerProposal({ id: "prop-1", suggestedCents: 1 }),
    ).toBeNull();
  });

  it("rejects non-integer, fractional, and negative cents", () => {
    const base = { id: "prop-1", categoryId: "cat-1" };
    expect(parsePlannerProposal({ ...base, suggestedCents: 75.5 })).toBeNull();
    expect(parsePlannerProposal({ ...base, suggestedCents: -1 })).toBeNull();
    expect(parsePlannerProposal({ ...base, suggestedCents: "75" })).toBeNull();
    expect(
      parsePlannerProposal({ ...base, suggestedCents: Number.NaN }),
    ).toBeNull();
  });

  it("rejects non-string ids, categories, and reasons", () => {
    expect(
      parsePlannerProposal({ id: 7, categoryId: "cat-1", suggestedCents: 1 }),
    ).toBeNull();
    expect(
      parsePlannerProposal({
        id: "prop-1",
        categoryId: true,
        suggestedCents: 1,
      }),
    ).toBeNull();
    expect(
      parsePlannerProposal({
        id: "prop-1",
        categoryId: "cat-1",
        suggestedCents: 1,
        reason: 42,
      }),
    ).toBeNull();
  });
});
