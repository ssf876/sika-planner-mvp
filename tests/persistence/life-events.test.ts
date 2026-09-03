import { beforeEach, describe, expect, it } from "vitest";

import { RepositoryError } from "@/lib/repositories/errors";
import { assignToCategory } from "@/lib/repositories/planner";
import {
  confirmLifeEvent,
  declareLifeEvent,
  dismissLifeEvent,
  proposeSeasonPlan,
  runLifeEventDetection,
} from "@/lib/repositories/life-events";

import {
  resetDatabase,
  seedHousehold,
  testDb,
  type SeededHousehold,
} from "./test-db";

beforeEach(resetDatabase);

/** A confirmed moving-vendor expense, categorized into any category. */
async function confirmedExpense(
  seed: SeededHousehold,
  payee: string,
  amountCents: number,
  date: string,
): Promise<void> {
  await testDb.transaction.create({
    data: {
      accountId: seed.accountIds.checking,
      categoryId: seed.categoryIds.groceries,
      kind: "EXPENSE",
      amountCents,
      date: new Date(`${date}T00:00:00.000Z`),
      payee,
      reviewState: "CONFIRMED",
    },
  });
}

describe("runLifeEventDetection — persistence", () => {
  it("persists candidates with evidence from confirmed categorizations", async () => {
    const seed = await seedHousehold("detect");
    await confirmedExpense(seed, "U-Haul Moving", -12900, "2026-08-30");
    await confirmedExpense(seed, "Self Storage Plus", -8900, "2026-09-03");

    const created = await runLifeEventDetection(
      testDb,
      seed.householdId,
      "2026-09-10",
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      kind: "MOVE",
      status: "CANDIDATE",
      evidence:
        '2 moving-related transactions in 30 days — "U-Haul Moving" (Aug 30), "Self Storage Plus" (Sep 3)',
    });
    expect(created[0]?.seasonStart).toEqual(
      new Date("2026-08-12T00:00:00.000Z"),
    );
  });

  it("screens only confirmed categorizations — NEEDS_REVIEW rows stay invisible", async () => {
    const seed = await seedHousehold("unreviewed");
    await testDb.transaction.create({
      data: {
        accountId: seed.accountIds.checking,
        categoryId: seed.categoryIds.groceries,
        kind: "EXPENSE",
        amountCents: -12900,
        date: new Date("2026-08-30T00:00:00.000Z"),
        payee: "U-Haul Moving",
        reviewState: "NEEDS_REVIEW",
      },
    });
    await confirmedExpense(seed, "Self Storage Plus", -8900, "2026-09-03");

    const created = await runLifeEventDetection(
      testDb,
      seed.householdId,
      "2026-09-10",
    );

    expect(created).toHaveLength(0);
  });

  it("is idempotent — a second pass creates nothing new", async () => {
    const seed = await seedHousehold("idempotent");
    await confirmedExpense(seed, "U-Haul Moving", -12900, "2026-08-30");
    await confirmedExpense(seed, "Self Storage Plus", -8900, "2026-09-03");

    await runLifeEventDetection(testDb, seed.householdId, "2026-09-10");
    const second = await runLifeEventDetection(
      testDb,
      seed.householdId,
      "2026-09-10",
    );

    expect(second).toHaveLength(0);
    const rows = await testDb.lifeEvent.findMany({
      where: { householdId: seed.householdId },
    });
    expect(rows).toHaveLength(1);
  });

  it("never reads another household's ledger — detection is tenancy-scoped", async () => {
    const seed = await seedHousehold("mine");
    const other = await seedHousehold("theirs");
    await confirmedExpense(other, "U-Haul Moving", -12900, "2026-08-30");
    await confirmedExpense(other, "Self Storage Plus", -8900, "2026-09-03");

    const created = await runLifeEventDetection(
      testDb,
      seed.householdId,
      "2026-09-10",
    );

    expect(created).toHaveLength(0);
  });
});

describe("confirmLifeEvent / dismissLifeEvent — the gate persists", () => {
  it("confirm persists CONFIRMED and keeps detection from re-candidating", async () => {
    const seed = await seedHousehold("confirm");
    await confirmedExpense(seed, "U-Haul Moving", -12900, "2026-08-30");
    await confirmedExpense(seed, "Self Storage Plus", -8900, "2026-09-03");
    const [candidate] = await runLifeEventDetection(
      testDb,
      seed.householdId,
      "2026-09-10",
    );

    await confirmLifeEvent(testDb, seed.householdId, candidate!.id);

    const row = await testDb.lifeEvent.findUnique({
      where: { id: candidate!.id },
    });
    expect(row?.status).toBe("CONFIRMED");

    await runLifeEventDetection(testDb, seed.householdId, "2026-09-10");
    const rows = await testDb.lifeEvent.findMany({
      where: { householdId: seed.householdId },
    });
    expect(rows).toHaveLength(1);
  });

  it("dismiss persists DISMISSED and suppresses the rule within the window", async () => {
    const seed = await seedHousehold("dismiss");
    await confirmedExpense(seed, "U-Haul Moving", -12900, "2026-08-30");
    await confirmedExpense(seed, "Self Storage Plus", -8900, "2026-09-03");
    const [candidate] = await runLifeEventDetection(
      testDb,
      seed.householdId,
      "2026-09-10",
    );

    await dismissLifeEvent(testDb, seed.householdId, candidate!.id);

    const row = await testDb.lifeEvent.findUnique({
      where: { id: candidate!.id },
    });
    expect(row?.status).toBe("DISMISSED");

    await runLifeEventDetection(testDb, seed.householdId, "2026-09-10");
    const rows = await testDb.lifeEvent.findMany({
      where: { householdId: seed.householdId },
    });
    expect(rows).toHaveLength(1); // the dismissed row, nothing new
  });

  it("dismissal expires — fresh evidence after the window fires again", async () => {
    const seed = await seedHousehold("dismiss-expiry");
    await confirmedExpense(seed, "U-Haul Moving", -12900, "2026-07-10");
    await confirmedExpense(seed, "Self Storage Plus", -8900, "2026-07-12");
    const [candidate] = await runLifeEventDetection(
      testDb,
      seed.householdId,
      "2026-07-20",
    );
    await dismissLifeEvent(testDb, seed.householdId, candidate!.id);

    // New confirmed moving spend, a month past the dismissed window's reach.
    await confirmedExpense(seed, "Two Men and a Truck", -25000, "2026-08-25");
    await confirmedExpense(seed, "U-Haul Moving", -12900, "2026-08-30");

    const again = await runLifeEventDetection(
      testDb,
      seed.householdId,
      "2026-09-10",
    );

    expect(again).toHaveLength(1);
    expect(again[0]?.kind).toBe("MOVE");
  });

  it("is household-scoped — another household's candidate is not found", async () => {
    const seed = await seedHousehold("owner");
    const other = await seedHousehold("other");
    const candidate = await testDb.lifeEvent.create({
      data: {
        householdId: other.householdId,
        kind: "MOVE",
        status: "CANDIDATE",
        evidence: "declared elsewhere",
      },
    });

    await expect(
      confirmLifeEvent(testDb, seed.householdId, candidate.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      dismissLifeEvent(testDb, seed.householdId, candidate.id),
    ).rejects.toBeInstanceOf(RepositoryError);
  });
});

describe("declareLifeEvent — the zero-history declaration", () => {
  it("persists CONFIRMED with no transactions at all", async () => {
    const seed = await seedHousehold("declare");
    const now = new Date("2026-09-10T08:00:00.000Z");

    await declareLifeEvent(testDb, seed.householdId, "MOVE", now);

    const rows = await testDb.lifeEvent.findMany({
      where: { householdId: seed.householdId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "MOVE",
      status: "CONFIRMED",
      evidence: "Declared by you",
    });
    expect(rows[0]?.seasonStart).toEqual(now);
  });

  it("a declared season keeps detection quiet for that kind", async () => {
    const seed = await seedHousehold("declare-quiet");
    await declareLifeEvent(
      testDb,
      seed.householdId,
      "MOVE",
      new Date("2026-09-10T08:00:00.000Z"),
    );
    await confirmedExpense(seed, "U-Haul Moving", -12900, "2026-08-30");
    await confirmedExpense(seed, "Self Storage Plus", -8900, "2026-09-03");

    const created = await runLifeEventDetection(
      testDb,
      seed.householdId,
      "2026-09-10",
    );

    expect(created).toHaveLength(0);
  });
});

describe("proposeSeasonPlan — the planner seam (D12)", () => {
  it("turns a confirmed event into template proposals over live assignments", async () => {
    const seed = await seedHousehold("season");
    await testDb.lifeEvent.create({
      data: {
        householdId: seed.householdId,
        kind: "CHILD",
        status: "CONFIRMED",
        evidence: "Declared by you",
      },
    });

    const proposals = await proposeSeasonPlan(
      testDb,
      seed.householdId,
      seed.monthId,
    );

    // Only Groceries exists in the seed household — the other template
    // lines (Insurance, Savings & Funds) are skipped.
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      id: "season:CHILD:" + seed.categoryIds.groceries,
      categoryId: seed.categoryIds.groceries,
      suggestedCents: 7_500,
    });
    expect(proposals[0]?.reason).toContain("Growing family season");
  });

  it("returns no proposals when the household has no confirmed seasons", async () => {
    const seed = await seedHousehold("quiet");
    const proposals = await proposeSeasonPlan(
      testDb,
      seed.householdId,
      seed.monthId,
    );
    expect(proposals).toEqual([]);
  });

  it("never proposes from another household's confirmed seasons", async () => {
    const seed = await seedHousehold("mine");
    const other = await seedHousehold("theirs");
    await testDb.lifeEvent.create({
      data: {
        householdId: other.householdId,
        kind: "MOVE",
        status: "CONFIRMED",
        evidence: "theirs",
      },
    });

    const proposals = await proposeSeasonPlan(
      testDb,
      seed.householdId,
      seed.monthId,
    );
    expect(proposals).toEqual([]);
  });

  it("applies proposal lines through the engine assign path, exactly as suggested", async () => {
    const seed = await seedHousehold("apply");
    await testDb.lifeEvent.create({
      data: {
        householdId: seed.householdId,
        kind: "CHILD",
        status: "CONFIRMED",
        evidence: "Declared by you",
      },
    });

    const proposals = await proposeSeasonPlan(
      testDb,
      seed.householdId,
      seed.monthId,
    );
    const line = proposals[0];
    expect(line).toBeDefined();

    // The apply path is the same assignToCategory the planner grid uses
    // (applyProposalAction wraps it) — engine.assign replaces the total.
    const result = await assignToCategory(testDb, seed.householdId, {
      monthId: seed.monthId,
      categoryId: line!.categoryId,
      cents: line!.suggestedCents,
    });

    const applied = result.availability.find(
      (row) => row.categoryId === seed.categoryIds.groceries,
    );
    expect(applied?.assignedCents).toBe(7_500);
  });

  it("suggests reallocations from a tight month's discretionary categories", async () => {
    const seed = await seedHousehold("tight");
    await testDb.lifeEvent.create({
      data: {
        householdId: seed.householdId,
        kind: "CHILD",
        status: "CONFIRMED",
        evidence: "Declared by you",
      },
    });
    // A zero-based month: 3,950.00 of the 4,000.00 income is already
    // assigned, so Ready to Assign (500) cannot cover the 7,500 target.
    await assignToCategory(testDb, seed.householdId, {
      monthId: seed.monthId,
      categoryId: seed.categoryIds.groceries,
      cents: 395_000,
    });
    await assignToCategory(testDb, seed.householdId, {
      monthId: seed.monthId,
      categoryId: seed.categoryIds.diningOut,
      cents: 30_000,
    });

    const proposals = await proposeSeasonPlan(
      testDb,
      seed.householdId,
      seed.monthId,
    );

    const groceries = proposals.find(
      (line) => line.categoryId === seed.categoryIds.groceries,
    );
    const diningOut = proposals.find(
      (line) => line.categoryId === seed.categoryIds.diningOut,
    );
    expect(groceries).toMatchObject({ suggestedCents: 402_500 }); // 395,000 + 7,500
    expect(diningOut).toMatchObject({ suggestedCents: 22_500 }); // 30,000 − 7,500 freed
  });
});

