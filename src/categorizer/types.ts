// Categorizer domain types — pure TypeScript, zero DB or framework imports.
//
// D5's deterministic learner (spec, "Transactions in"): suggest a category
// from the household's confirmed history — exact-payee match first, then a
// keyword/token match — with a confidence in 0..1. No ML in v1 (Assumption
// A3): the only evidence is what the user actually confirmed.

/** One confirmed categorization from the household's history. */
export interface ConfirmedCategorization {
  payee: string;
  categoryId: string;
  /** Household-local ISO date ("YYYY-MM-DD") of the confirmed transaction. */
  date: string;
}

export interface CategorizerSuggestion {
  categoryId: string;
  /** 0..1. Exactly 1 for an exact-payee match (spec: most recent wins). */
  confidence: number;
}

/**
 * The spec's Categorizer contract. Callers pass a full `FeedTransaction`;
 * the v1 learner consumes only the payee, so the input narrows to the fields
 * that can actually change a suggestion.
 */
export interface Categorizer {
  /** Suggest a category from confirmed history, or null when nothing matches. */
  suggest(tx: { payee: string }): CategorizerSuggestion | null;
  /** Record a user confirm/edit so the next identical payee matches exactly. */
  learn(tx: { payee: string; categoryId: string }): void;
}
