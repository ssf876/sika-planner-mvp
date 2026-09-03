import { describe, expect, it } from "vitest";

import { CsvParseError, parseCsv } from "@/src/feed/csv";

describe("parseCsv", () => {
  it("splits rows on newlines and fields on commas", () => {
    expect(parseCsv("a,b,c\nd,e,f")).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  it("treats CRLF as a row ending, not two", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a final row without a trailing newline", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("preserves empty fields and rows of empty fields", () => {
    expect(parseCsv("a,,c\n\nd,e")).toEqual([
      ["a", "", "c"],
      [""],
      ["d", "e"],
    ]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('one,"a, b",two')).toEqual([["one", "a, b", "two"]]);
  });

  it("unescapes doubled quotes inside quoted fields", () => {
    expect(parseCsv('"she said ""hi""",x')).toEqual([['she said "hi"', "x"]]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('"line one\nline two",b')).toEqual([
      ["line one\nline two", "b"],
    ]);
  });

  it("strips a leading BOM from the first header", () => {
    expect(parseCsv("﻿Date,Amount")[0]).toEqual(["Date", "Amount"]);
  });

  it("throws on a quote inside an unquoted field", () => {
    expect(() => parseCsv('ab"c,d')).toThrow(CsvParseError);
  });

  it("throws on an unclosed quoted field", () => {
    expect(() => parseCsv('a,"unclosed')).toThrow(CsvParseError);
  });
});
