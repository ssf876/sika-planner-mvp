// Public surface of the categorizer module (mirrors src/engine's barrel).
export type {
  Categorizer,
  CategorizerSuggestion,
  ConfirmedCategorization,
} from "./types";
export {
  AUTO_ACCEPT_CONFIDENCE,
  EXACT_MATCH_CONFIDENCE,
  KEYWORD_MATCH_MAX_CONFIDENCE,
  createCategorizer,
} from "./categorizer";
