// The life-event advisor's detection half (spec D11 + A6) — deterministic
// rule packs over the household's CONFIRMED categorizations, the same stream
// the categorizer learns from. No ML: every candidate traces to transactions
// the user actually confirmed, and every candidate carries human-readable
// evidence so the confirm gate is an informed decision, not a leap of faith.
//
// Pure module: no DB, no framework. The repository layer loads the confirmed
// stream and prior LifeEvent rows, then persists the candidates this returns.

import { normalizePayee } from "@/src/categorizer";
import type { LifeEventKind } from "@/src/engine/types";
import { formatCents } from "@/lib/money";

export type { LifeEventKind };

/** Kinds the rule packs detect — CUSTOM exists only as a user declaration. */
export type DetectableLifeEventKind = Exclude<LifeEventKind, "CUSTOM">;

/** One confirmed expense the detector screens. */
export interface ConfirmedExpenseRow {
  transactionId: string;
  payee: string;
  /** Negative — a confirmed outflow (expenses are signed money out). */
  amountCents: number;
  /** Household-local ISO date ("YYYY-MM-DD"). */
  date: string;
}

/** A household's prior life-event row, for the suppression rules. */
export interface PriorLifeEventRow {
  kind: LifeEventKind;
  status: "CANDIDATE" | "CONFIRMED" | "DISMISSED";
  /** ISO date the detected (or declared) season started, or null. */
  seasonStart: string | null;
}

/** A detection the dashboard should put in front of the user. */
export interface LifeEventCandidate {
  kind: DetectableLifeEventKind;
  /** Human-readable detector summary shown on the Life events card. */
  evidence: string;
  /** First day of the evidence window (ISO) — the season's anchor date. */
  seasonStart: string;
}

// ─── Rule packs (A6: keyword sets + spending-velocity signals) ───────────────

export interface LifeEventRulePack {
  kind: DetectableLifeEventKind;
  /** Names the spending in evidence copy, e.g. "moving-related". */
  evidenceNoun: string;
  /**
   * Keyword phrases matched against the normalized payee with word
   * boundaries — "storage" matches "Self Storage Plus" but not "Restore".
   */
  keywords: readonly string[];
  /** Spending-velocity window ending today, inclusive days. */
  windowDays: number;
  /** Distinct matching transactions the window must hold to fire. */
  minMatches: number;
  /**
   * Secondary velocity trigger: a single matching payment at or above this
   * amount fires the rule alone — life changes often announce themselves
   * with one large payment (a closing-cost wire) rather than a burst.
   */
  largePaymentCents?: number;
}

export const LIFE_EVENT_RULE_PACKS: readonly LifeEventRulePack[] = [
  {
    kind: "HOME_PURCHASE",
    evidenceNoun: "housing",
    keywords: [
      "mortgage",
      "escrow",
      "title",
      "closing",
      "deed",
      "home inspection",
      "hoa",
    ],
    // Closing costs and down payments are one-time wires, so a single large
    // housing payment carries the rule on its own.
    windowDays: 45,
    minMatches: 2,
    largePaymentCents: 250_000, // $2,500.00
  },
  {
    kind: "MOVE",
    evidenceNoun: "moving",
    keywords: [
      "moving",
      "movers",
      "mover",
      "storage",
      "u haul",
      "truck rental",
      "two men and a truck",
      "boxes",
      "self storage",
    ],
    windowDays: 30,
    minMatches: 2,
  },
  {
    kind: "WEDDING",
    evidenceNoun: "wedding",
    keywords: [
      "wedding",
      "bridal",
      "bride",
      "groom",
      "venue",
      "venues",
      "florist",
      "florists",
      "caterer",
      "caterers",
      "catering",
      "photographer",
      "photographers",
      "wedding planner",
      "wedding planners",
      "rehearsal dinner",
    ],
    // Weddings spread across many distinct vendors in a short season.
    windowDays: 45,
    minMatches: 3,
  },
  {
    kind: "CHILD",
    evidenceNoun: "childcare",
    keywords: [
      "daycare",
      "day care",
      "childcare",
      "child care",
      "pediatric",
      "pediatrician",
      "nursery",
      "maternity",
      "obstetric",
      "babysitter",
      "diapers",
      "formula",
    ],
    // Childcare recurs — two hits in six weeks is already a pattern.
    windowDays: 45,
    minMatches: 2,
  },
];

// ─── Matching ────────────────────────────────────────────────────────────────

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary phrase match, precompiled per pack so detection stays cheap. */
const KEYWORD_MATCHERS = new Map<string, RegExp[]>(
  LIFE_EVENT_RULE_PACKS.map((pack) => [
    pack.kind,
    pack.keywords.map(
      (keyword) =>
        new RegExp(`\\b${escapeRegExp(keyword)}\\b`), // keywords are already normalized-shaped
    ),
  ]),
);

function matchesPack(pack: LifeEventRulePack, payee: string): boolean {
  const normalized = normalizePayee(payee);
  if (!normalized) return false;
  return (KEYWORD_MATCHERS.get(pack.kind) ?? []).some((matcher) =>
    matcher.test(normalized),
  );
}

// ─── Date arithmetic on ISO calendar dates (deterministic, UTC-anchored) ─────

const DAY_MS = 86_400_000;

function parseIsoDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: string, days: number): string {
  return new Date(parseIsoDate(date).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "2026-08-22" → "Aug 22" — evidence copy never trusts the locale. */
function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}`;
}

// ─── Evidence ────────────────────────────────────────────────────────────────

const EVIDENCE_PAYEE_LIMIT = 3;

function truncate(payee: string): string {
  return payee.length > 40 ? `${payee.slice(0, 39)}…` : payee;
}

function velocityEvidence(
  pack: LifeEventRulePack,
  matches: ConfirmedExpenseRow[],
): string {
  const listed = matches
    .slice(0, EVIDENCE_PAYEE_LIMIT)
    .map((match) => `"${truncate(match.payee)}" (${shortDate(match.date)})`);
  const more = matches.length > EVIDENCE_PAYEE_LIMIT ? ", …" : "";
  return (
    `${matches.length} ${pack.evidenceNoun}-related transactions in ` +
    `${pack.windowDays} days — ${listed.join(", ")}${more}`
  );
}

function largePaymentEvidence(
  pack: LifeEventRulePack,
  match: ConfirmedExpenseRow,
): string {
  return (
    `Large ${pack.evidenceNoun} payment — "${truncate(match.payee)}" for ` +
    `${formatCents(-match.amountCents)} on ${shortDate(match.date)}`
  );
}

// ─── Suppression (spec: "dismiss → rule suppressed") ─────────────────────────

/**
 * A rule stays quiet while its evidence window can still overlap a dismissed
 * row's own evidence window: dismissal silences the rule for a full detection
 * window past the dismissed season, and fresh spending after that is news
 * again. An open or confirmed season for the kind always suppresses — a
 * pending candidate already sits on the card, and a confirmed season needs
 * no second opinion.
 */
function isSuppressed(
  pack: LifeEventRulePack,
  priorEvents: readonly PriorLifeEventRow[],
  today: string,
  windowStart: string,
): boolean {
  return priorEvents.some((event) => {
    if (event.kind !== pack.kind) return false;
    if (event.status === "CANDIDATE" || event.status === "CONFIRMED") {
      return true;
    }
    // DISMISSED — suppress while the windows overlap.
    if (!event.seasonStart) return false; // fail open toward detection
    const dismissedWindowEnd = addDays(event.seasonStart, pack.windowDays);
    return windowStart <= dismissedWindowEnd && event.seasonStart <= today;
  });
}

// ─── Detection ───────────────────────────────────────────────────────────────

export interface LifeEventDetectionInput {
  /** The household's confirmed (human-reviewed) expense rows. */
  confirmed: readonly ConfirmedExpenseRow[];
  /** The household's prior life-event rows, for suppression. */
  priorEvents: readonly PriorLifeEventRow[];
  /** Household-local ISO date the detection runs on. */
  today: string;
}

/**
 * Run every rule pack over the confirmed stream. Candidates come back in
 * pack order with stable, human-readable evidence; a kind emits at most one
 * candidate per run. Callers persist the result as CANDIDATE rows — the
 * repository layer owns that, and re-running is safe because an existing
 * candidate suppresses its kind until the user decides.
 */
export function detectLifeEventCandidates(
  input: LifeEventDetectionInput,
): LifeEventCandidate[] {
  const { confirmed, priorEvents, today } = input;

  // Date order with a stable tiebreak, so evidence never depends on the
  // caller's row order.
  const ordered = confirmed
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) => a.row.date.localeCompare(b.row.date) || a.index - b.index,
    )
    .map(({ row }) => row);

  const candidates: LifeEventCandidate[] = [];
  for (const pack of LIFE_EVENT_RULE_PACKS) {
    const windowStart = addDays(today, -(pack.windowDays - 1));
    if (isSuppressed(pack, priorEvents, today, windowStart)) continue;

    const matches = ordered.filter(
      (row) =>
        row.date >= windowStart &&
        row.date <= today &&
        matchesPack(pack, row.payee),
    );
    if (matches.length === 0) continue;

    const largePayment =
      pack.largePaymentCents != null
        ? matches.find((match) => -match.amountCents >= pack.largePaymentCents!)
        : undefined;

    if (matches.length >= pack.minMatches) {
      candidates.push({
        kind: pack.kind,
        evidence: velocityEvidence(pack, matches),
        seasonStart: windowStart,
      });
    } else if (largePayment) {
      candidates.push({
        kind: pack.kind,
        evidence: largePaymentEvidence(pack, largePayment),
        seasonStart: windowStart,
      });
    }
  }
  return candidates;
}
