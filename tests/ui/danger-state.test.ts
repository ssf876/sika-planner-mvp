import { describe, expect, it } from "vitest";
import {
  WATCH_THRESHOLD,
  classifySpendState,
} from "@/components/ui/danger-state";

describe("classifySpendState", () => {
  it.each([
    { spent: 0, total: 5500, expected: "healthy" },
    { spent: 1600, total: 5500, expected: "healthy" }, // mock-up Housing row
    { spent: 4124, total: 5500, expected: "healthy" }, // one cent under watch
    { spent: 4125, total: 5500, expected: "watch" }, // exactly 75%
    { spent: 4200, total: 5500, expected: "watch" },
    { spent: 5500, total: 5500, expected: "watch" }, // fully spent, not over
    { spent: 5501, total: 5500, expected: "overspent" }, // one cent over
    { spent: 0, total: 0, expected: "healthy" }, // nothing budgeted, nothing spent
    { spent: 1, total: 0, expected: "overspent" },
  ])(
    "classifies $spent of $total as $expected",
    ({ spent, total, expected }) => {
      expect(classifySpendState(spent, total)).toBe(expected);
    },
  );

  it("rejects non-integer cents", () => {
    expect(() => classifySpendState(10.5, 100)).toThrow(TypeError);
  });

  it("rejects negative amounts", () => {
    expect(() => classifySpendState(-1, 100)).toThrow(RangeError);
  });

  it("exposes the watch threshold as a fraction", () => {
    expect(WATCH_THRESHOLD).toBe(0.75);
  });
});
