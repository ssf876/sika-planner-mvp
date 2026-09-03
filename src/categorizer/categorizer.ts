// The deterministic categorizer (D5) — exact-payee match first, then a
// keyword/token match over the household's confirmed history. No ML (spec
// Assumption A3): every suggestion traces to categorizations the user made.
//
// Confidence semantics (spec: "High-confidence matches (> 0.9) can
// auto-accept per household setting"):
//   - exact payee   → 1      — the user confirmed this very payee
//   - keyword match → ≤ 0.8  — partial evidence always stays in the queue
// so only an exact match can ever cross the 0.9 auto-accept line.

import type {
  Categorizer,
  CategorizerSuggestion,
  ConfirmedCategorization,
} from "./types";

/** Suggestions at or above this may auto-accept per household setting. */
export const AUTO_ACCEPT_CONFIDENCE = 0.9;

/** Exact-payee matches are certain: the user confirmed this payee before. */
export const EXACT_MATCH_CONFIDENCE = 1;

/** Keyword matches top out below the auto-accept line — evidence is partial. */
export const KEYWORD_MATCH_MAX_CONFIDENCE = 0.8;

/** Lowercase, punctuation runs → single spaces, trimmed: "Whole Foods, Inc."
 * and "whole foods inc" are the same payee. */
function normalizePayee(payee: string): string {
  return payee
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Per-category evidence for one token: confirmations count plus how recent
 * the most recent one is (rank 0 = most recent). */
interface TokenEvidence {
  count: number;
  lastSeenRank: number;
}

export function createCategorizer(
  history: ConfirmedCategorization[],
): Categorizer {
  // Most-recent-first rank per row: exact match takes the most recent
  // category (spec), and recency breaks keyword ties deterministically.
  const ranked = [...history].sort((a, b) => b.date.localeCompare(a.date));

  /** Normalized payee → most recent category, with its recency rank. */
  const exactIndex = new Map<string, { categoryId: string; rank: number }>();
  /** Normalized token → category → evidence. */
  const tokenIndex = new Map<string, Map<string, TokenEvidence>>();

  const index = (row: ConfirmedCategorization, rank: number): void => {
    const key = normalizePayee(row.payee);
    if (!key || !row.categoryId) return;
    const existing = exactIndex.get(key);
    if (!existing || rank < existing.rank) {
      exactIndex.set(key, { categoryId: row.categoryId, rank });
    }
    for (const token of key.split(" ")) {
      let categories = tokenIndex.get(token);
      if (!categories) {
        categories = new Map();
        tokenIndex.set(token, categories);
      }
      const evidence = categories.get(row.categoryId) ?? {
        count: 0,
        lastSeenRank: rank,
      };
      categories.set(row.categoryId, {
        count: evidence.count + 1,
        lastSeenRank: Math.min(evidence.lastSeenRank, rank),
      });
    }
  };

  ranked.forEach((row, rank) => index(row, rank));

  return {
    suggest(tx: { payee: string }): CategorizerSuggestion | null {
      const key = normalizePayee(tx.payee);
      if (!key) return null;

      const exact = exactIndex.get(key);
      if (exact) {
        return { categoryId: exact.categoryId, confidence: EXACT_MATCH_CONFIDENCE };
      }

      const tokens = key.split(" ");
      // Each token casts one vote for its best-evidenced category (most
      // confirmations; recency breaks ties).
      const votes = new Map<string, { count: number; bestRank: number }>();
      for (const token of tokens) {
        const categories = tokenIndex.get(token);
        if (!categories) continue;
        let winner: { categoryId: string; evidence: TokenEvidence } | null =
          null;
        for (const [categoryId, evidence] of categories) {
          if (
            !winner ||
            evidence.count > winner.evidence.count ||
            (evidence.count === winner.evidence.count &&
              evidence.lastSeenRank < winner.evidence.lastSeenRank)
          ) {
            winner = { categoryId, evidence };
          }
        }
        if (!winner) continue;
        const tally = votes.get(winner.categoryId) ?? {
          count: 0,
          bestRank: Number.POSITIVE_INFINITY,
        };
        votes.set(winner.categoryId, {
          count: tally.count + 1,
          bestRank: Math.min(tally.bestRank, winner.evidence.lastSeenRank),
        });
      }
      if (votes.size === 0) return null;

      // Most token votes wins; recency of evidence breaks ties; the
      // lexicographic last resort keeps the result fully deterministic.
      let best: { categoryId: string; tally: { count: number; bestRank: number } } | null =
        null;
      for (const [categoryId, tally] of votes) {
        if (
          !best ||
          tally.count > best.tally.count ||
          (tally.count === best.tally.count &&
            (tally.bestRank < best.tally.bestRank ||
              (tally.bestRank === best.tally.bestRank &&
                categoryId < best.categoryId)))
        ) {
          best = { categoryId, tally };
        }
      }
      if (!best) return null;

      return {
        categoryId: best.categoryId,
        confidence:
          (KEYWORD_MATCH_MAX_CONFIDENCE * best.tally.count) / tokens.length,
      };
    },

    learn(tx: { payee: string; categoryId: string }): void {
      if (!tx.payee.trim() || !tx.categoryId) {
        throw new Error(
          "learn requires a non-empty payee and categoryId — refusing to record a blank categorization",
        );
      }
      // Re-rank: the learned row is now the most recent confirmation.
      for (const exact of exactIndex.values()) exact.rank += 1;
      for (const categories of tokenIndex.values()) {
        for (const evidence of categories.values()) {
          evidence.lastSeenRank += 1;
        }
      }
      index({ payee: tx.payee, categoryId: tx.categoryId, date: "" }, 0);
    },
  };
}
