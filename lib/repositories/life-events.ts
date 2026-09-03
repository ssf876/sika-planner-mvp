/**
 * Life-event advisor persistence (D11) — wires the pure rule packs in
 * src/advisor to the household's confirmed stream and the LifeEvent table.
 *
 * Detection runs whenever the dashboard renders: it reads the same
 * CONFIRMED/EDITED stream the categorizer learns from, emits CANDIDATE rows
 * with human-readable evidence, and lets the pure suppression rules keep
 * dismissed rules quiet. Confirm/dismiss/declare are the user's side of the
 * gate (the dashboard card's three verbs); each persists in one place so the
 * server actions stay thin wrappers.
 */

import type { PrismaClient } from "@prisma/client";

import {
  detectLifeEventCandidates,
  type ConfirmedExpenseRow,
  type DetectableLifeEventKind,
  type LifeEventKind,
  type PriorLifeEventRow,
} from "@/src/advisor";

import { RepositoryError } from "./errors";
import type { Db } from "./engine-state";

/** Review-state values that represent a human categorization decision. */
const LEARNED_REVIEW_STATES = ["CONFIRMED", "EDITED"] as const;

/**
 * The confirmed expense stream the rule packs screen — the same human-reviewed
 * rows the categorizer learns from (AUTO_ACCEPTED excluded, so a detector
 * never reads its own ecosystem's unverified guesses).
 */
export async function loadConfirmedExpenses(
  db: Db,
  householdId: string,
): Promise<ConfirmedExpenseRow[]> {
  const rows = await db.transaction.findMany({
    where: {
      account: { householdId },
      kind: "EXPENSE",
      categoryId: { not: null },
      reviewState: { in: [...LEARNED_REVIEW_STATES] },
    },
    select: { id: true, payee: true, amountCents: true, date: true },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    transactionId: row.id,
    payee: row.payee,
    amountCents: row.amountCents,
    date: row.date.toISOString().slice(0, 10),
  }));
}

function priorEventRows(
  events: { kind: string; status: string; seasonStart: Date | null }[],
): PriorLifeEventRow[] {
  return events.map((event) => ({
    kind: event.kind as LifeEventKind,
    status: event.status as PriorLifeEventRow["status"],
    seasonStart: event.seasonStart
      ? event.seasonStart.toISOString().slice(0, 10)
      : null,
  }));
}

/**
 * One detection pass (D11): run the rule packs over the confirmed stream and
 * persist new CANDIDATE rows. Returns the rows it created. Re-running is
 * safe — the pure layer suppresses kinds that already have an open or
 * confirmed season, so a dashboard render never duplicates candidates.
 */
export async function runLifeEventDetection(
  db: Db,
  householdId: string,
  today: string,
) {
  const [confirmed, prior] = await Promise.all([
    loadConfirmedExpenses(db, householdId),
    db.lifeEvent.findMany({
      where: { householdId },
      select: { kind: true, status: true, seasonStart: true },
    }),
  ]);

  const candidates = detectLifeEventCandidates({
    confirmed,
    priorEvents: priorEventRows(prior),
    today,
  });

  const created = [];
  for (const candidate of candidates) {
    // Belt and braces for concurrent renders: re-check suppression at write
    // time so a parallel pass can't double-create the same kind.
    const open = await db.lifeEvent.findFirst({
      where: { householdId, kind: candidate.kind, status: { not: "DISMISSED" } },
      select: { id: true },
    });
    if (open) continue;
    created.push(
      await db.lifeEvent.create({
        data: {
          householdId,
          kind: candidate.kind,
          status: "CANDIDATE",
          evidence: candidate.evidence,
          seasonStart: new Date(`${candidate.seasonStart}T00:00:00.000Z`),
        },
      }),
    );
  }
  return created;
}

// ─── The confirmation gate: confirm / dismiss / declare (dashboard card) ────

/**
 * Confirm a detected candidate (D11): CANDIDATE → CONFIRMED, which activates
 * the season template in the planner (D12). Household-scoped: an id from
 * another household updates nothing and reports not found.
 */
export async function confirmLifeEvent(
  db: PrismaClient,
  householdId: string,
  eventId: string,
): Promise<void> {
  const updated = await db.lifeEvent.updateMany({
    where: { id: eventId, householdId, status: "CANDIDATE" },
    data: { status: "CONFIRMED" },
  });
  if (updated.count === 0) {
    throw new RepositoryError(
      "NOT_FOUND",
      "That life event no longer needs a decision — refresh the dashboard.",
    );
  }
}

/**
 * Dismiss a candidate: persists DISMISSED, and the suppression rules keep
 * that kind's rule quiet while its evidence window can still overlap the
 * dismissed one (spec: "dismiss → rule suppressed").
 */
export async function dismissLifeEvent(
  db: PrismaClient,
  householdId: string,
  eventId: string,
): Promise<void> {
  const updated = await db.lifeEvent.updateMany({
    where: { id: eventId, householdId, status: "CANDIDATE" },
    data: { status: "DISMISSED" },
  });
  if (updated.count === 0) {
    throw new RepositoryError(
      "NOT_FOUND",
      "That life event no longer needs a decision — refresh the dashboard.",
    );
  }
}

/**
 * Declare a season manually — the cold-start path that works with zero
 * history ("I'm moving"). A declaration is the user's own confirmation, so
 * it persists as CONFIRMED straight away and the season template can
 * propose against it.
 */
export async function declareLifeEvent(
  db: PrismaClient,
  householdId: string,
  kind: DetectableLifeEventKind | "CUSTOM",
  now: Date,
): Promise<void> {
  await db.lifeEvent.create({
    data: {
      householdId,
      kind,
      status: "CONFIRMED",
      evidence: "Declared by you",
      seasonStart: now,
    },
  });
}
