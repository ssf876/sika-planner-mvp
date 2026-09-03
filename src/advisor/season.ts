// The life-event advisor's proposal half (spec D12) — turn a confirmed
// season into concrete planner suggestions: a category template plus
// suggested reallocations. Pure module: no DB, no framework. The repository
// hydrates live category rows and Ready-to-Assign, and the planner renders
// the returned lines as proposal rows that mutate nothing until Apply.
//
// engine.assign REPLACES a category's allocation, so every line's
// suggestedCents is the NEW month total for that category, never a delta —
// applying a line through the planner's assign path lands exactly here.

import type { CategoryGroup } from "@/src/engine";
import type { LifeEventKind } from "@/src/engine/types";

import { formatCents } from "@/lib/money";

// ─── Season templates ────────────────────────────────────────────────────────

interface SeasonTemplateLine {
  /** Canonical onboarding category name; missing categories are skipped. */
  categoryName: string;
  /** Extra cents this season needs on top of the current assignment. */
  targetCents: number;
  /** Why the season touches this category — shown on the proposal row. */
  note: string;
}

export interface SeasonTemplate {
  kind: LifeEventKind;
  /** Human-readable season name, e.g. "Moving season". */
  label: string;
  lines: readonly SeasonTemplateLine[];
  /**
   * Most season spending should come from re-purposing discretionary money,
   * not new income: WANTS categories with an assignment are reduced by up to
   * this amount each when Ready-to-Assign can't cover the template.
   */
  reallocateCapCents: number;
}

/**
 * v1 season templates over onboarding's canonical category names (same
 * name-based mapping as the windfall goal lines): a household that renamed
 * or removed a category simply gets fewer proposed lines, never a broken
 * apply path. Amounts are modest first-month suggestions — every line is
 * edited or applied by the user, so a wrong guess costs nothing.
 */
export const SEASON_TEMPLATES: readonly SeasonTemplate[] = [
  {
    kind: "HOME_PURCHASE",
    label: "Home purchase season",
    lines: [
      {
        categoryName: "Rent / Mortgage",
        targetCents: 50_000,
        note: "the new housing payment lands mid-month",
      },
      {
        categoryName: "Utilities",
        targetCents: 5_000,
        note: "setup and move-in service charges",
      },
      {
        categoryName: "Insurance",
        targetCents: 2_500,
        note: "policy updates for the new home",
      },
    ],
    reallocateCapCents: 10_000,
  },
  {
    kind: "MOVE",
    label: "Moving season",
    lines: [
      {
        categoryName: "Transportation",
        targetCents: 2_500,
        note: "fuel for the moving-day runs",
      },
      {
        categoryName: "Dining Out",
        targetCents: 7_500,
        note: "cooking is the first thing a move breaks",
      },
      {
        categoryName: "Shopping",
        targetCents: 5_000,
        note: "boxes, tape, and the forgotten basics",
      },
    ],
    reallocateCapCents: 7_500,
  },
  {
    kind: "WEDDING",
    label: "Wedding season",
    lines: [
      {
        categoryName: "Shopping",
        targetCents: 15_000,
        note: "attire and ceremony odds and ends",
      },
      {
        categoryName: "Dining Out",
        targetCents: 10_000,
        note: "rehearsal dinner and celebrations",
      },
      {
        categoryName: "Savings & Funds",
        targetCents: 25_000,
        note: "the wedding fund gets the season's focus",
      },
    ],
    reallocateCapCents: 15_000,
  },
  {
    kind: "CHILD",
    label: "Growing family season",
    lines: [
      {
        categoryName: "Groceries",
        targetCents: 7_500,
        note: "formula and diapers live here for now",
      },
      {
        categoryName: "Insurance",
        targetCents: 5_000,
        note: "adding the newest member to the policy",
      },
      {
        categoryName: "Savings & Funds",
        targetCents: 10_000,
        note: "the college fund starts small and starts now",
      },
    ],
    reallocateCapCents: 7_500,
  },
  {
    kind: "CUSTOM",
    label: "Busy season",
    lines: [
      {
        categoryName: "Savings & Funds",
        targetCents: 10_000,
        note: "a buffer for whatever this season brings — edit to taste",
      },
    ],
    reallocateCapCents: 5_000,
  },
];

// ─── Proposal math ───────────────────────────────────────────────────────────

/** One live category row the proposal math reads. */
export interface SeasonProposalCategoryRow {
  categoryId: string;
  name: string;
  group: CategoryGroup;
  /** The month's current assignment for the category (engine truth). */
  assignedCents: number;
}

export interface SeasonProposalContext {
  kind: LifeEventKind;
  /** The household's categories for the month, with current assignments. */
  categories: readonly SeasonProposalCategoryRow[];
  /** Ready to Assign for the month — the first source of season funding. */
  readyToAssignCents: number;
}

/**
 * One suggestion the planner renders as a proposal row. suggestedCents is
 * the NEW assignment total for the category (engine.assign replaces).
 */
export interface SeasonProposalLine {
  id: string;
  categoryId: string;
  suggestedCents: number;
  reason: string;
}

export interface SeasonProposal {
  kind: LifeEventKind;
  label: string;
  lines: readonly SeasonProposalLine[];
}

const REALLOCATION_GROUP: CategoryGroup = "WANTS";

function templateFor(kind: LifeEventKind): SeasonTemplate {
  return (
    SEASON_TEMPLATES.find((template) => template.kind === kind) ??
    // Caller bug (unknown kind) — degrade to an empty template rather than
    // guessing at categories.
    { kind, label: "Life season", lines: [], reallocateCapCents: 0 }
  );
}

function categoryByName(
  categories: readonly SeasonProposalCategoryRow[],
  name: string,
): SeasonProposalCategoryRow | undefined {
  return categories.find((row) => row.name === name);
}

function proposalId(kind: LifeEventKind, categoryId: string): string {
  return `season:${kind}:${categoryId}`;
}

/**
 * Build one season's planner suggestions (D12): fund the template lines as
 * top-ups, and when Ready-to-Assign can't cover the season, suggest
 * deterministic reallocations from discretionary (WANTS) categories. Lines
 * for categories the household doesn't have are skipped, and a category
 * never appears on two lines of the same proposal.
 */
export function buildSeasonProposal(
  context: SeasonProposalContext,
): SeasonProposal {
  const { kind, categories, readyToAssignCents } = context;
  const template = templateFor(kind);

  const lines: SeasonProposalLine[] = [];
  const usedCategoryIds = new Set<string>();
  let totalTargetCents = 0;

  for (const line of template.lines) {
    const category = categoryByName(categories, line.categoryName);
    if (!category || usedCategoryIds.has(category.categoryId)) continue;

    const suggestedCents = category.assignedCents + line.targetCents;
    totalTargetCents += line.targetCents;
    usedCategoryIds.add(category.categoryId);
    lines.push({
      id: proposalId(kind, category.categoryId),
      categoryId: category.categoryId,
      suggestedCents,
      reason: `${template.label} — ${line.note} (was ${formatCents(category.assignedCents)})`,
    });
  }

  // Reallocations only when free money can't cover the season — and only
  // from WANTS rows that aren't already part of the template.
  const shortfallCents = totalTargetCents - readyToAssignCents;
  if (shortfallCents > 0) {
    let remainingCents = shortfallCents;
    const candidates = categories
      .filter(
        (row) =>
          row.group === REALLOCATION_GROUP &&
          row.assignedCents > 0 &&
          !usedCategoryIds.has(row.categoryId),
      )
      .sort((a, b) => a.name.localeCompare(b.name)); // deterministic order

    for (const candidate of candidates) {
      if (remainingCents === 0) break;
      const freedCents = Math.min(
        candidate.assignedCents,
        remainingCents,
        template.reallocateCapCents,
      );
      if (freedCents <= 0) continue;
      remainingCents -= freedCents;
      usedCategoryIds.add(candidate.categoryId);
      lines.push({
        id: proposalId(kind, candidate.categoryId),
        categoryId: candidate.categoryId,
        suggestedCents: candidate.assignedCents - freedCents,
        reason:
          `${template.label} — free up ${formatCents(freedCents)} for season costs ` +
          `(was ${formatCents(candidate.assignedCents)})`,
      });
    }
  }

  return { kind, label: template.label, lines };
}
