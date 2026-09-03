// Public surface of the advisor module (mirrors src/categorizer's barrel).
export {
  LIFE_EVENT_RULE_PACKS,
  detectLifeEventCandidates,
  type ConfirmedExpenseRow,
  type DetectableLifeEventKind,
  type LifeEventCandidate,
  type LifeEventKind,
  type LifeEventDetectionInput,
  type LifeEventRulePack,
  type PriorLifeEventRow,
} from "./life-events";
export {
  SEASON_TEMPLATES,
  buildSeasonProposal,
  type SeasonProposal,
  type SeasonProposalCategoryRow,
  type SeasonProposalContext,
  type SeasonProposalLine,
  type SeasonTemplate,
} from "./season";
