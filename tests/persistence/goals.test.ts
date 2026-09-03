import { beforeEach, describe, expect, it } from "vitest";

import {
  createGoal,
  listGoals,
  setGoalActive,
  updateGoal,
} from "@/lib/repositories/goals";

import {
  resetDatabase,
  seedHousehold,
  testDb,
  type SeededHousehold,
} from "./test-db";

let seeded: SeededHousehold;

beforeEach(async () => {
  await resetDatabase();
  seeded = await seedHousehold(`goals-${crypto.randomUUID()}`);
});

describe("createGoal (D8)", () => {
  it("persists a goal for the household", async () => {
    const { id } = await createGoal(testDb, seeded.householdId, {
      kind: "PAYOFF_DEBT",
      name: "Clear the card",
      targetCents: 250000,
    });

    const goal = await testDb.goal.findUniqueOrThrow({ where: { id } });
    expect(goal).toMatchObject({
      householdId: seeded.householdId,
      kind: "PAYOFF_DEBT",
      name: "Clear the card",
      targetCents: 250000,
      active: true,
    });
  });

  it("allows an open-ended goal with no target", async () => {
    const { id } = await createGoal(testDb, seeded.householdId, {
      kind: "CUSTOM",
      name: "Breathe easier",
    });
    const goal = await testDb.goal.findUniqueOrThrow({ where: { id } });
    expect(goal.targetCents).toBeNull();
  });

  it("rejects blank names and non-positive targets", async () => {
    await expect(
      createGoal(testDb, seeded.householdId, { kind: "CUSTOM", name: "   " }),
    ).rejects.toMatchObject({ name: "RepositoryError", code: "INVALID_NAME" });

    await expect(
      createGoal(testDb, seeded.householdId, {
        kind: "CUSTOM",
        name: "Zero",
        targetCents: 0,
      }),
    ).rejects.toMatchObject({
      name: "RepositoryError",
      code: "INVALID_TARGET",
    });
  });
});

describe("updateGoal (D8)", () => {
  it("edits kind, name, and target together", async () => {
    const { id } = await createGoal(testDb, seeded.householdId, {
      kind: "CUSTOM",
      name: "Emergency fund",
      targetCents: 50000,
    });

    await updateGoal(testDb, seeded.householdId, id, {
      kind: "GROW_NET_WORTH",
      name: "Six-month cushion",
      targetCents: 180000,
    });

    const goal = await testDb.goal.findUniqueOrThrow({ where: { id } });
    expect(goal).toMatchObject({
      kind: "GROW_NET_WORTH",
      name: "Six-month cushion",
      targetCents: 180000,
    });
  });

  it("never edits another household's goal", async () => {
    const { id } = await createGoal(testDb, seeded.householdId, {
      kind: "CUSTOM",
      name: "Theirs",
    });
    const other = await seedHousehold(`other-${crypto.randomUUID()}`);

    await expect(
      updateGoal(testDb, other.householdId, id, {
        kind: "CUSTOM",
        name: "Hijacked",
      }),
    ).rejects.toMatchObject({ name: "RepositoryError", code: "NOT_FOUND" });

    const goal = await testDb.goal.findUniqueOrThrow({ where: { id } });
    expect(goal.name).toBe("Theirs");
  });
});

describe("setGoalActive — retire and reactivate (D8)", () => {
  it("flips active false and back true", async () => {
    const { id } = await createGoal(testDb, seeded.householdId, {
      kind: "CUSTOM",
      name: "New roof",
    });

    await setGoalActive(testDb, seeded.householdId, id, false);
    const retired = await testDb.goal.findUniqueOrThrow({ where: { id } });
    expect(retired.active).toBe(false);

    await setGoalActive(testDb, seeded.householdId, id, true);
    const revived = await testDb.goal.findUniqueOrThrow({ where: { id } });
    expect(revived.active).toBe(true);
  });

  it("refuses to toggle another household's goal", async () => {
    const { id } = await createGoal(testDb, seeded.householdId, {
      kind: "CUSTOM",
      name: "Sabbatical",
    });
    const other = await seedHousehold(`other-${crypto.randomUUID()}`);

    await expect(
      setGoalActive(testDb, other.householdId, id, false),
    ).rejects.toMatchObject({ name: "RepositoryError", code: "NOT_FOUND" });
  });
});

describe("listGoals (D8)", () => {
  it("returns only this household's goals, active first", async () => {
    await createGoal(testDb, seeded.householdId, {
      kind: "CUSTOM",
      name: "Older retired goal",
    });
    const retiredId = (
      await testDb.goal.findFirstOrThrow({ where: { name: "Older retired goal" } })
    ).id;
    await setGoalActive(testDb, seeded.householdId, retiredId, false);
    await createGoal(testDb, seeded.householdId, {
      kind: "PAYOFF_DEBT",
      name: "Active goal",
    });
    const other = await seedHousehold(`other-${crypto.randomUUID()}`);
    await createGoal(testDb, other.householdId, {
      kind: "CUSTOM",
      name: "Someone else's goal",
    });

    const goals = await listGoals(testDb, seeded.householdId);

    expect(goals.map((g) => g.name)).toEqual(["Active goal", "Older retired goal"]);
    expect(goals[0].active).toBe(true);
    expect(goals[1].active).toBe(false);
  });
});
