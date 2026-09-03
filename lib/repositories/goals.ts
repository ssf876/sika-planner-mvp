/**
 * Goals repository (D8) — editable advisor data. Goals are plain rows (no
 * engine involvement): the advisor reads them to rank windfall proposals, so
 * create/edit/toggle is honest CRUD scoped to one household.
 */

import type { GoalKind } from "@prisma/client";
import { RepositoryError } from "./errors";
import type { Db } from "./engine-state";

export interface GoalRow {
  id: string;
  kind: GoalKind;
  name: string;
  targetCents?: number;
  active: boolean;
}

export async function listGoals(db: Db, householdId: string): Promise<GoalRow[]> {
  const goals = await db.goal.findMany({
    where: { householdId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, kind: true, name: true, targetCents: true, active: true },
  });
  return goals.map((g) => ({
    id: g.id,
    kind: g.kind,
    name: g.name,
    targetCents: g.targetCents ?? undefined,
    active: g.active,
  }));
}

export interface CreateGoalInput {
  kind: GoalKind;
  name: string;
  targetCents?: number;
}

/** Create a goal. Active by default — onboarding seeds the first one this way. */
export async function createGoal(
  db: Db,
  householdId: string,
  input: CreateGoalInput,
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw new RepositoryError("INVALID_NAME", "Name the goal.");
  if (input.targetCents != null && input.targetCents <= 0) {
    throw new RepositoryError(
      "INVALID_TARGET",
      "Target must be greater than zero.",
    );
  }
  const goal = await db.goal.create({
    data: {
      householdId,
      kind: input.kind,
      name,
      targetCents: input.targetCents,
      active: true,
    },
    select: { id: true },
  });
  return { id: goal.id };
}

export interface UpdateGoalInput {
  kind?: GoalKind;
  name?: string;
  targetCents?: number;
}

/** Update an owned goal. Throws NOT_FOUND for another household's row. */
export async function updateGoal(
  db: Db,
  householdId: string,
  goalId: string,
  input: UpdateGoalInput,
): Promise<void> {
  await requireOwnedGoal(db, householdId, goalId);
  if (input.targetCents != null && input.targetCents <= 0) {
    throw new RepositoryError(
      "INVALID_TARGET",
      "Target must be greater than zero.",
    );
  }
  await db.goal.update({
    where: { id: goalId },
    data: {
      kind: input.kind,
      name: input.name === undefined ? undefined : input.name.trim(),
      targetCents: input.targetCents,
    },
  });
}

/**
 * Toggle a goal's active flag. Deactivating (not deleting) is the retire path:
 * windfall ranking stops considering it, but history stays put.
 */
export async function setGoalActive(
  db: Db,
  householdId: string,
  goalId: string,
  active: boolean,
): Promise<void> {
  await requireOwnedGoal(db, householdId, goalId);
  await db.goal.update({
    where: { id: goalId },
    data: { active },
  });
}

/** Throws NOT_FOUND unless the goal exists inside this household. */
async function requireOwnedGoal(
  db: Db,
  householdId: string,
  goalId: string,
): Promise<void> {
  const owned = await db.goal.findFirst({
    where: { id: goalId, householdId },
    select: { id: true },
  });
  if (!owned) {
    throw new RepositoryError(
      "NOT_FOUND",
      "That goal doesn't exist for your household.",
    );
  }
}
