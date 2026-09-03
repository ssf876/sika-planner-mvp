import { describe, expect, it } from "vitest";

import { formatCents } from "@/lib/money";

describe("formatCents", () => {
  it("formats positive cents as dollars", () => {
    expect(formatCents(12345)).toBe("$123.45");
  });

  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats negative cents (overspent categories)", () => {
    expect(formatCents(-2500)).toBe("-$25.00");
  });

  it("pads sub-dollar amounts", () => {
    expect(formatCents(7)).toBe("$0.07");
  });

  it("groups thousands", () => {
    expect(formatCents(1080000)).toBe("$10,800.00");
  });

  it("rejects non-integer cents — money is Int cents everywhere", () => {
    expect(() => formatCents(12.5)).toThrow(TypeError);
  });
});
