// CSV AccountFeed adapter (D4) — the "csv" implementation of the spec's
// pluggable feed interface. Wraps one uploaded export mapped through a saved
// column mapping; a future "plaid" adapter implements the same contract.

import { applyCsvMapping } from "./mapping";
import type {
  AccountFeed,
  AccountRef,
  CsvColumnMapping,
  FeedTransaction,
} from "./types";

export class CsvFeed implements AccountFeed {
  readonly kind = "csv";

  constructor(
    private readonly csvText: string,
    private readonly mapping: CsvColumnMapping,
  ) {}

  /**
   * Importable rows only. Malformed rows are the mapping layer's report —
   * the UI surfaces them before import — so the AccountFeed contract carries
   * just the transactions an import can stage.
   */
  async listNew(
    _account: AccountRef,
    since?: Date,
  ): Promise<FeedTransaction[]> {
    const { transactions } = applyCsvMapping(this.csvText, this.mapping);
    if (!since) return transactions;

    // Feed dates are household-local ISO calendar dates (spec A4); compare
    // lexicographically against the since date's calendar date.
    const sinceDate = since.toISOString().slice(0, 10);
    return transactions.filter((tx) => tx.date >= sinceDate);
  }
}
