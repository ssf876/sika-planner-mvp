import { describe, expect, it } from "vitest";

import {
  detectWindfallIncome,
  parseWindfallLine,
  rankWindfallAllocation,
  type WindfallIncomeRow,
  type WindfallRankContext,
} from "@/lib/planner/windfall";

function incomeRows(
  defs: Array<[payee: string, amountCents: number, date: string]>,
): WindfallIncomeRow[] {
  return defs.map(([payee, amountCents, date], index) => ({
    transactionId: `tx-${index}`,
    payee,
    amountCents,
    date,
  }));
}

function rankContext(
  overrides: Partial<WindfallRankContext> = {},
): WindfallRankContext {
  return {
    monthId: "month-1",
    asOf: { year: 2026, month: 9 },
    riskAppetite: "BALANCED",
    categories: [
      {
        categoryId: "cat-groceries",
        name: "Groceries",
        availableCents: -8000,
      },
      { categoryId: "cat-fun", name: "Fun money", availableCents: 2500 },
    ],
    funds: [
      {
        fundId: "fund-ef",
        name: "Emergency fund",
        kind: "SINKING",
        targetCents: 50000,
        targetDate: "2026-10-01",
        balanceCents: 30000,
        plannedThisMonthCents: 5000,
      },
      {
        fundId: "fund-car",
        name: "Car repair",
        kind: "SINKING",
        targetCents: 10000,
        targetDate: "2027-01-01",
        balanceCents: 4000,
        plannedThisMonthCents: 1000,
      },
      {
        fundId: "fund-buffer",
        name: "Buffer",
        kind: "STATIC",
        targetCents: 20000,
        targetDate: "2026-12-01",
        balanceCents: 0,
        plannedThisMonthCents: 0,
      },
    ],
    goal: {
      goalId: "goal-1",
      name: "Pay off credit card",
      kind: "PAYOFF_DEBT",
      targetCents: 15000,
      suggestedCategoryId: "cat-debt",
    },
    ...overrides,
  };
}

describe("detectWindfallIncome — A7 running-total heuristic", () => {
  it("flags nothing when income exactly meets expectations", () => {
    const detection = detectWindfallIncome(
      incomeRows([["Acme payroll", 500000, "2026-09-01"]]),
      500000,
    );
    expect(detection).toEqual({ windfallCents: 0, flaggedTransactionIds: [] });
  });

  it("auto-flags the deposit that pushes the month past expected income", () => {
    const detection = detectWindfallIncome(
      incomeRows([
        ["Acme payroll", 500000, "2026-09-01"],
        ["Stripe payout", 75000, "2026-09-12"],
      ]),
      500000,
    );
    expect(detection.windfallCents).toBe(75000);
    expect(detection.flaggedTransactionIds).toEqual(["tx-1"]);
  });

  it("flags an expected source that overshoots expectations — the excess is windfall", () => {
    const detection = detectWindfallIncome(
      incomeRows([["Acme payroll", 900000, "2026-09-01"]]),
      500000,
    );
    expect(detection.windfallCents).toBe(400000);
    expect(detection.flaggedTransactionIds).toEqual(["tx-0"]);
  });

  it("flags every deposit after the running total crosses expected, in date order", () => {
    const detection = detectWindfallIncome(
      incomeRows([
        ["Stripe payout", 30000, "2026-09-20"],
        ["Acme payroll", 500000, "2026-09-01"],
        ["Birthday gift", 2500, "2026-09-05"],
      ]),
      500000,
    );
    expect(detection.windfallCents).toBe(32500);
    // Payroll (Sep 1) stays under expectations; the gift (Sep 5) crosses the
    // line and everything after it flags too — regardless of input order.
    expect(detection.flaggedTransactionIds).toEqual(["tx-2", "tx-0"]);
  });

  it("leaves sub-expected income unflagged no matter the source", () => {
    const detection = detectWindfallIncome(
      incomeRows([
        ["Acme payroll", 300000, "2026-09-01"],
        ["Side refund", 5000, "2026-09-15"],
      ]),
      500000,
    );
    expect(detection).toEqual({ windfallCents: 0, flaggedTransactionIds: [] });
  });

  it("treats the exact expected total as the boundary (not above it)", () => {
    const detection = detectWindfallIncome(
      incomeRows([
        ["Acme payroll", 300000, "2026-09-01"],
        ["Q3 bonus", 200000, "2026-09-10"],
      ]),
      500000,
    );
    expect(detection).toEqual({ windfallCents: 0, flaggedTransactionIds: [] });
  });

  it("sees no windfall when there are no income rows", () => {
    const detection = detectWindfallIncome([], 500000);
    expect(detection).toEqual({ windfallCents: 0, flaggedTransactionIds: [] });
  });

  it("flags everything in a zero-expectation month — honest, by design", () => {
    const detection = detectWindfallIncome(
      incomeRows([
        ["Acme payroll", 100000, "2026-09-01"],
        ["Refund", 100, "2026-09-08"],
      ]),
      0,
    );
    expect(detection.flaggedTransactionIds).toEqual(["tx-0", "tx-1"]);
    expect(detection.windfallCents).toBe(100100);
  });
});

describe("parseWindfallLine — the apply action's trust boundary", () => {
  it("accepts each well-formed line shape", () => {
    expect(
      parseWindfallLine({
        kind: "category",
        lineId: "line-1",
        categoryId: "cat-1",
        name: "Groceries",
        suggestedCents: 8000,
        reason: "Overspent — cover the shortfall",
      }),
    ).toEqual({
      kind: "category",
      lineId: "line-1",
      categoryId: "cat-1",
      name: "Groceries",
      suggestedCents: 8000,
      reason: "Overspent — cover the shortfall",
    });
    expect(
      parseWindfallLine({
        kind: "fund",
        lineId: "line-2",
        fundId: "fund-1",
        name: "Emergency fund",
        suggestedCents: 15000,
      })?.kind,
    ).toBe("fund");
    expect(
      parseWindfallLine({
        kind: "goal",
        lineId: "line-3",
        goalId: "goal-1",
        name: "Pay off credit card",
        suggestedCategoryId: "cat-debt",
        suggestedCents: 6000,
      })?.kind,
    ).toBe("goal");
    expect(
      parseWindfallLine({
        kind: "remainder",
        lineId: "line-4",
        suggestedCents: 2000,
      })?.kind,
    ).toBe("remainder");
  });

  it("accepts a goal line without a mapped category (guidance-only)", () => {
    const line = parseWindfallLine({
      kind: "goal",
      lineId: "line-3",
      goalId: "goal-1",
      name: "Pay off credit card",
      suggestedCents: 6000,
    });
    expect(line).toMatchObject({ kind: "goal", suggestedCategoryId: undefined });
  });

  it("rejects non-objects, unknown kinds, and missing ids", () => {
    expect(parseWindfallLine(null)).toBeNull();
    expect(parseWindfallLine("line-1")).toBeNull();
    expect(parseWindfallLine({ kind: "surprise", lineId: "x" })).toBeNull();
    expect(
      parseWindfallLine({ kind: "category", suggestedCents: 1 }),
    ).toBeNull();
    expect(
      parseWindfallLine({ kind: "fund", lineId: "x", suggestedCents: 1 }),
    ).toBeNull();
    expect(
      parseWindfallLine({ kind: "goal", lineId: "x", suggestedCents: 1 }),
    ).toBeNull();
  });

  it("rejects non-integer, negative, and non-number cents", () => {
    const base = {
      kind: "category",
      lineId: "l",
      categoryId: "c",
      name: "Groceries",
    };
    expect(parseWindfallLine({ ...base, suggestedCents: 75.5 })).toBeNull();
    expect(parseWindfallLine({ ...base, suggestedCents: -1 })).toBeNull();
    expect(parseWindfallLine({ ...base, suggestedCents: "8000" })).toBeNull();
    expect(
      parseWindfallLine({ ...base, suggestedCents: Number.NaN }),
    ).toBeNull();
  });

  it("rejects non-string labels, names, and category ids", () => {
    expect(
      parseWindfallLine({
        kind: "category",
        lineId: 7,
        categoryId: "c",
        name: "Groceries",
        suggestedCents: 1,
      }),
    ).toBeNull();
    expect(
      parseWindfallLine({
        kind: "category",
        lineId: "l",
        categoryId: "c",
        suggestedCents: 1,
        reason: 42,
      }),
    ).toBeNull();
    expect(
      parseWindfallLine({
        kind: "category",
        lineId: "l",
        categoryId: "c",
        name: 9,
        suggestedCents: 1,
      }),
    ).toBeNull();
    expect(
      parseWindfallLine({
        kind: "goal",
        lineId: "l",
        goalId: "g",
        name: "Goal",
        suggestedCategoryId: 11,
        suggestedCents: 1,
      }),
    ).toBeNull();
  });
});

describe("rankWindfallAllocation — proposal ranking", () => {
  it("ranks overspent categories, then behind sinking funds, then the goal, then the remainder", () => {
    // 25000 waterfall: groceries 8000 → emergency fund (capped by what's
    // left) → nothing remains for the goal → remainder 0.
    const proposal = rankWindfallAllocation(rankContext(), 25000);
    expect(proposal.lines.map((line) => line.lineId)).toEqual([
      "windfall:category:cat-groceries",
      "windfall:fund:fund-ef",
      "windfall:remainder",
    ]);
  });

  it("sizes the overspend at the deficit, worst deficit first", () => {
    const proposal = rankWindfallAllocation(rankContext(), 25000);
    expect(proposal.lines[0]).toMatchObject({
      lineId: "windfall:category:cat-groceries",
      categoryId: "cat-groceries",
      suggestedCents: 8000,
      reason: "Overspent — cover the shortfall",
    });
  });

  it("sizes a fund top-up by the engine's gap, capped by what earlier ranks left", () => {
    const proposal = rankWindfallAllocation(rankContext(), 25000);
    // Emergency fund gap: 50000 - 30000 = 20000; only 17000 remains.
    expect(proposal.lines[1]).toMatchObject({
      lineId: "windfall:fund:fund-ef",
      fundId: "fund-ef",
      suggestedCents: 17000,
    });
  });

  it("distributes a larger windfall across all four ranks", () => {
    const proposal = rankWindfallAllocation(rankContext(), 40000);
    expect(proposal.lines.map((line) => line.lineId)).toEqual([
      "windfall:category:cat-groceries",
      "windfall:fund:fund-ef",
      "windfall:fund:fund-car",
      "windfall:goal:goal-1",
      "windfall:remainder",
    ]);
    expect(proposal.lines.map((line) => line.suggestedCents)).toEqual([
      8000, 20000, 6000, 3000, 3000,
    ]);
  });

  it("always includes the remainder — zero when the waterfall assigns everything", () => {
    const proposal = rankWindfallAllocation(rankContext(), 25000);
    const remainder = proposal.lines.at(-1);
    expect(remainder).toMatchObject({
      kind: "remainder",
      suggestedCents: 0,
    });
    const total = proposal.lines.reduce(
      (sum, line) => sum + line.suggestedCents,
      0,
    );
    expect(total).toBe(25000);
  });

  it("returns an empty plan for a zero or negative windfall", () => {
    expect(rankWindfallAllocation(rankContext(), 0).lines).toEqual([]);
    expect(rankWindfallAllocation(rankContext(), -5).lines).toEqual([]);
  });

  it("weights the goal by the household's risk appetite (25/50/100)", () => {
    const clean = rankContext({ categories: [], funds: [] });
    const cautious = rankWindfallAllocation(
      { ...clean, riskAppetite: "CAUTIOUS" },
      10000,
    );
    const balanced = rankWindfallAllocation(
      { ...clean, riskAppetite: "BALANCED" },
      10000,
    );
    const aggressive = rankWindfallAllocation(
      { ...clean, riskAppetite: "AGGRESSIVE" },
      10000,
    );
    expect(cautious.lines[0]?.suggestedCents).toBe(2500);
    expect(balanced.lines[0]?.suggestedCents).toBe(5000);
    expect(aggressive.lines[0]?.suggestedCents).toBe(10000);
  });

  it("keeps category sizing appetite-blind while appetite scales fund verdicts", () => {
    const balanced = rankWindfallAllocation(
      { ...rankContext(), riskAppetite: "BALANCED" },
      40000,
    );
    const aggressive = rankWindfallAllocation(
      { ...rankContext(), riskAppetite: "AGGRESSIVE" },
      40000,
    );
    // The overspend cover is identical — deficits are appetite-blind.
    expect(aggressive.lines[0]).toEqual(balanced.lines[0]);
    // The emergency fund is behind under both appetites, same top-up.
    expect(aggressive.lines[1]).toEqual(balanced.lines[1]);
    // But the car fund's 25% slack clears it under AGGRESSIVE while it
    // ranks under BALANCED, and the freed remainder flows into the goal.
    expect(
      balanced.lines.some((line) => line.lineId === "windfall:fund:fund-car"),
    ).toBe(true);
    expect(
      aggressive.lines.some((line) => line.lineId === "windfall:fund:fund-car"),
    ).toBe(false);
    expect(aggressive.lines[2]).toMatchObject({
      lineId: "windfall:goal:goal-1",
      suggestedCents: 12000,
    });
  });

  it("re-ranks live when the active goal changes — the new goal names the plan", () => {
    const before = rankContext({ categories: [], funds: [] });
    const after = rankContext({
      categories: [],
      funds: [],
      goal: {
        goalId: "goal-2",
        name: "Emergency cushion",
        kind: "GROW_NET_WORTH",
        targetCents: 40000,
        suggestedCategoryId: "cat-savings",
      },
    });

    const planBefore = rankWindfallAllocation(before, 10000);
    const planAfter = rankWindfallAllocation(after, 10000);

    // Deterministic from context: same inputs, same plan.
    expect(rankWindfallAllocation(before, 10000)).toEqual(planBefore);
    // Edited goal → the fresh plan names and sizes the new goal.
    expect(planAfter.lines[0]).toMatchObject({
      kind: "goal",
      lineId: "windfall:goal:goal-2",
      name: "Emergency cushion",
      suggestedCents: 5000, // BALANCED 50% of 10000
    });
  });

  it("never asks past a goal's target", () => {
    const proposal = rankWindfallAllocation(
      rankContext({
        categories: [],
        funds: [],
        goal: {
          goalId: "goal-1",
          name: "Pay off credit card",
          kind: "PAYOFF_DEBT",
          targetCents: 3000,
          suggestedCategoryId: "cat-debt",
        },
      }),
      10000,
    );
    expect(proposal.lines[0]).toMatchObject({ suggestedCents: 3000 });
    expect(proposal.lines.at(-1)).toMatchObject({ suggestedCents: 7000 });
  });

  it("treats an open-ended goal (no target) as uncapped at the appetite share", () => {
    const proposal = rankWindfallAllocation(
      rankContext({
        categories: [],
        funds: [],
        goal: {
          goalId: "goal-1",
          name: "Pay off credit card",
          kind: "PAYOFF_DEBT",
          suggestedCategoryId: "cat-debt",
        },
      }),
      10000,
    );
    expect(proposal.lines[0]).toMatchObject({ suggestedCents: 5000 }); // BALANCED 50%
  });

  it("still proposes the goal as guidance when no category maps to it", () => {
    const proposal = rankWindfallAllocation(
      rankContext({
        categories: [],
        funds: [],
        goal: {
          goalId: "goal-1",
          name: "Pay off credit card",
          kind: "PAYOFF_DEBT",
          targetCents: 15000,
          suggestedCategoryId: undefined,
        },
      }),
      10000,
    );
    expect(proposal.lines[0]).toMatchObject({
      kind: "goal",
      suggestedCategoryId: undefined,
      suggestedCents: 5000,
    });
  });

  it("proposes only the remainder when nothing needs money", () => {
    const proposal = rankWindfallAllocation(
      rankContext({ categories: [], funds: [], goal: null }),
      25000,
    );
    expect(proposal.lines).toHaveLength(1);
    expect(proposal.lines[0]).toMatchObject({
      kind: "remainder",
      suggestedCents: 25000,
    });
  });

  it("keeps equal-severity overspends in the engine's category order", () => {
    const proposal = rankWindfallAllocation(
      rankContext({
        categories: [
          { categoryId: "cat-b", name: "Dining", availableCents: -100 },
          { categoryId: "cat-a", name: "Groceries", availableCents: -100 },
        ],
        funds: [],
        goal: null,
      }),
      10000,
    );
    expect(proposal.lines.map((line) => line.lineId)).toEqual([
      "windfall:category:cat-b",
      "windfall:category:cat-a",
      "windfall:remainder",
    ]);
  });

  it("excludes static funds and sinking funds that are not behind their pace", () => {
    const proposal = rankWindfallAllocation(
      rankContext({
        categories: [],
        funds: [
          {
            fundId: "fund-buffer",
            name: "Buffer",
            kind: "STATIC",
            targetCents: 20000,
            targetDate: "2026-12-01",
            balanceCents: 0,
            plannedThisMonthCents: 0,
          },
          {
            // gap 0 — fully funded, healthy regardless of deadline.
            fundId: "fund-done",
            name: "Done deal",
            kind: "SINKING",
            targetCents: 10000,
            targetDate: "2026-09-30",
            balanceCents: 10000,
            plannedThisMonthCents: 0,
          },
          {
            // Planned funding covers the required pace under BALANCED.
            fundId: "fund-onpace",
            name: "Vacation 2027",
            kind: "SINKING",
            targetCents: 120000,
            targetDate: "2027-05-01",
            balanceCents: 0,
            plannedThisMonthCents: 13334,
          },
        ],
        goal: null,
      }),
      25000,
    );
    expect(proposal.lines).toHaveLength(1);
    expect(proposal.lines[0]?.kind).toBe("remainder");
  });

  it("ranks behind funds by urgency — most urgent target date first", () => {
    const proposal = rankWindfallAllocation(
      rankContext({
        categories: [],
        funds: [
          {
            fundId: "fund-late",
            name: "Taxes",
            kind: "SINKING",
            targetCents: 60000,
            targetDate: "2026-12-01",
            balanceCents: 0,
            plannedThisMonthCents: 0,
          },
          {
            fundId: "fund-soon",
            name: "Rent deposit",
            kind: "SINKING",
            targetCents: 60000,
            targetDate: "2026-09-30",
            balanceCents: 0,
            plannedThisMonthCents: 0,
          },
        ],
        goal: null,
      }),
      70000,
    );
    expect(proposal.lines.map((line) => line.lineId)).toEqual([
      "windfall:fund:fund-soon",
      "windfall:fund:fund-late",
      "windfall:remainder",
    ]);
    expect(proposal.lines.map((line) => line.suggestedCents)).toEqual([
      60000, 10000, 0,
    ]);
  });
});
