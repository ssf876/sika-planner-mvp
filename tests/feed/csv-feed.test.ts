import { describe, expect, it } from "vitest";

import { CsvFeed } from "@/src/feed/csv-feed";
import type { CsvColumnMapping } from "@/src/feed/types";

const mapping: CsvColumnMapping = {
  date: "Date",
  payee: "Description",
  amount: "Amount",
  externalId: "Transaction ID",
  pending: "Status",
};

const csv = [
  "Transaction ID,Date,Description,Amount,Status",
  "TXN-1,2026-09-01,Whole Foods,-86.40,POSTED",
  "TXN-2,2026-09-15,Payroll,2500.00,POSTED",
].join("\n");

describe("CsvFeed", () => {
  it("is a csv-kind AccountFeed producing mapped transactions", async () => {
    const feed = new CsvFeed(csv, mapping);
    expect(feed.kind).toBe("csv");

    const transactions = await feed.listNew({ accountId: "acc-1" });
    expect(transactions.map((tx) => tx.externalId)).toEqual(["TXN-1", "TXN-2"]);
    expect(transactions[0]).toMatchObject({
      date: "2026-09-01",
      payee: "Whole Foods",
      amountCents: -8640,
      pending: false,
    });
  });

  it("filters rows older than the since date", async () => {
    const feed = new CsvFeed(csv, mapping);
    const transactions = await feed.listNew(
      { accountId: "acc-1" },
      new Date("2026-09-10T00:00:00.000Z"),
    );
    expect(transactions.map((tx) => tx.externalId)).toEqual(["TXN-2"]);
  });
});
