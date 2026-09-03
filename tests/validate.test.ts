import { describe, expect, it } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  parseIncomeToCents,
  validateEmail,
  validatePassword,
} from "@/lib/auth/validate";

describe("validateEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(validateEmail("shanice@example.com")).toBeNull();
  });

  it("normalizes casing and surrounding whitespace", () => {
    expect(validateEmail("  Shanice@Example.COM ")).toBeNull();
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "nope", "a@b", "a b@c.com", "@x.com"]) {
      expect(validateEmail(bad)).toMatch(/valid email/i);
    }
  });
});

describe("validatePassword", () => {
  it("accepts passwords at or above the minimum length", () => {
    expect(validatePassword("12345678")).toBeNull();
  });

  it("rejects short passwords", () => {
    expect(validatePassword("1234567")).toMatch(
      new RegExp(`at least ${MIN_PASSWORD_LENGTH}`),
    );
  });
});

describe("parseIncomeToCents", () => {
  it("parses plain dollars into cents", () => {
    expect(parseIncomeToCents("5000")).toBe(500000);
  });

  it("accepts commas, dollar signs, and spaces", () => {
    expect(parseIncomeToCents("$5,000")).toBe(500000);
    expect(parseIncomeToCents(" 2,500.75 ")).toBe(250075);
  });

  it("accepts two-decimal precision", () => {
    expect(parseIncomeToCents("10.13")).toBe(1013);
  });

  it("returns null for garbage, negatives, and overflow", () => {
    expect(parseIncomeToCents("")).toBeNull();
    expect(parseIncomeToCents("abc")).toBeNull();
    expect(parseIncomeToCents("-50")).toBeNull();
    expect(parseIncomeToCents("1.234")).toBeNull();
    expect(parseIncomeToCents("9".repeat(20))).toBeNull();
  });
});
