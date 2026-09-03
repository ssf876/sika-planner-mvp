// Danger zone view tests (D3): the 4 states × 3 appetites matrix, fund-pace
// math, appetite boundary sweeps, threshold tuning, and overall rollup.
//
// The spec contract: healthy / watch / overspent / funding-behind, computed
// from riskAppetite + availableCents + fund pace. Thresholds are tunable;
// the states are the contract.

import { describe, expect, it } from "vitest";
import { createBudgetEngine } from "@/src/engine/engine";
import { EngineError } from "@/src/engine/errors";
import {
  assessFundPace,
  classifyAvailability,
  computeFundPace,
  resolveDangerThresholds,
  worstDangerState,
} from "@/src/engine/danger";
import type {
  DangerState,
  EngineState,
  FundPace,
  RiskAppetite,
} from "@/src/engine/types";

// ── state builders ───────────────────────────────────────────────────────────

const MONTH_ID = "m-2026-09";
const GROCERIES = "cat-groceries";
const CAR = "cat-car";
const CAR_FUND = "fund-car";

const baseState = (overrides: Partial<EngineState> = {}): EngineState => ({
  householdId: "h1",
  accounts: [
    {
      id: "acc1",
      householdId: "h1",
      kind: "CHECKING",
      name: "Checking",
      startingCents: 500_000,
    },
  ],
  categories: [
    { id: GROCERIES, householdId: "h1", group: "NEEDS", name: "Groceries" },
    {
      id: CAR,
      householdId: "h1",
      group: "NEEDS",
      name: "Car repair",
      fundId: CAR_FUND,
    },
  ],
  months: [
    {
      id: MONTH_ID,
      householdId: "h1",
      year: 2026,
      month: 9,
      expectedIncomeCents: 400_000,
    },
  ],
  allocations: [],
  transactions: [],
  funds: [
    {
      id: CAR_FUND,
      householdId: "h1",
      kind: "SINKING",
      name: "Car repair",
      targetCents: 120_000,
      targetDate: "2027-03-31",
      balanceCents: 50_000,
    },
  ],
  fundDraws: [],
  transfers: [],
  ...overrides,
});

/**
 * Engine with Groceries assigned $100 and `grocerySpend` spent against it.
 * The car bucket is funded at its required pace (10_000) so the fund is
 * on-pace unless a test assigns it differently — keeps availability scenarios
 * isolated from pace.
 */
const engineWithGrocerySpend = (
  grocerySpend: number,
  overrides: Partial<EngineState> = {},
) => {
  const engine = createBudgetEngine(baseState(overrides));
  engine.assign(MONTH_ID, GROCERIES, 10_000);
  engine.assign(MONTH_ID, CAR, 10_000);
  if (grocerySpend > 0) {
    engine.recordTransaction({
      accountId: "acc1",
      kind: "EXPENSE",
      amountCents: -grocerySpend,
      date: "2026-09-15",
      payee: "Store",
      categoryId: GROCERIES,
    });
  }
  return engine;
};

// ── the 12-cell matrix: 4 states × 3 appetites, through the engine view ─────

describe("danger zone matrix (4 states × 3 appetites)", () => {
  // Groceries is assigned 10_000; spend sets its availability. The car fund
  // targets 120_000 with 50_000 saved and 7 months of runway from 2026-09,
  // so the required pace is ceil(70_000 / 7) = 10_000/month.
  const matrix: Array<{
    state: DangerState;
    appetite: RiskAppetite;
    grocerySpend: number;
    carAssigned: number;
  }> = [
    // healthy — available comfortably above each appetite's watch line
    {
      state: "healthy",
      appetite: "CAUTIOUS",
      grocerySpend: 7_000,
      carAssigned: 10_000,
    },
    {
      state: "healthy",
      appetite: "BALANCED",
      grocerySpend: 8_000,
      carAssigned: 10_000,
    },
    {
      state: "healthy",
      appetite: "AGGRESSIVE",
      grocerySpend: 9_200,
      carAssigned: 10_000,
    },
    // watch — available exactly at each appetite's watch line
    {
      state: "watch",
      appetite: "CAUTIOUS",
      grocerySpend: 7_500,
      carAssigned: 10_000,
    },
    {
      state: "watch",
      appetite: "BALANCED",
      grocerySpend: 9_000,
      carAssigned: 10_000,
    },
    {
      state: "watch",
      appetite: "AGGRESSIVE",
      grocerySpend: 9_500,
      carAssigned: 10_000,
    },
    // overspent — available < 0, appetite-independent
    {
      state: "overspent",
      appetite: "CAUTIOUS",
      grocerySpend: 10_001,
      carAssigned: 10_000,
    },
    {
      state: "overspent",
      appetite: "BALANCED",
      grocerySpend: 10_001,
      carAssigned: 10_000,
    },
    {
      state: "overspent",
      appetite: "AGGRESSIVE",
      grocerySpend: 10_001,
      carAssigned: 10_000,
    },
    // funding-behind — month's plan short of the appetite-scaled required pace
    {
      state: "funding-behind",
      appetite: "CAUTIOUS",
      grocerySpend: 0,
      carAssigned: 9_900,
    },
    {
      state: "funding-behind",
      appetite: "BALANCED",
      grocerySpend: 0,
      carAssigned: 8_900,
    },
    {
      state: "funding-behind",
      appetite: "AGGRESSIVE",
      grocerySpend: 0,
      carAssigned: 7_400,
    },
  ];

  it.each(matrix)(
    "$state under $appetite",
    ({ state, appetite, grocerySpend, carAssigned }) => {
      const engine = engineWithGrocerySpend(grocerySpend, {
        riskAppetite: appetite,
      });
      engine.assign(MONTH_ID, CAR, carAssigned);

      const report = engine.dangerZone(MONTH_ID);
      const groceries = report.categories.find(
        (c) => c.categoryId === GROCERIES,
      );
      const car = report.categories.find((c) => c.categoryId === CAR);

      expect(report.riskAppetite).toBe(appetite);
      if (state === "funding-behind") {
        expect(car?.state).toBe(state);
        expect(groceries?.state).toBe("healthy");
      } else {
        expect(groceries?.state).toBe(state);
        expect(car?.state).toBe("healthy");
      }
      expect(report.overall).toBe(state);
    },
  );
});

// ── watch boundary sweeps: the line moves with the appetite ─────────────────

describe("watch thresholds tighten/loosen by appetite", () => {
  const defaults = resolveDangerThresholds();

  it.each([
    ["CAUTIOUS", 2_500, "watch"],
    ["CAUTIOUS", 2_501, "healthy"],
    ["BALANCED", 1_000, "watch"],
    ["BALANCED", 1_001, "healthy"],
    ["AGGRESSIVE", 500, "watch"],
    ["AGGRESSIVE", 501, "healthy"],
  ] as Array<[RiskAppetite, number, DangerState]>)(
    "%s flips exactly at %i available of 10_000 assigned",
    (appetite, availableCents, expected) => {
      expect(
        classifyAvailability(availableCents, 10_000, appetite, defaults),
      ).toBe(expected);
    },
  );

  it("BALANCED watches at ≤ 10% of assigned (spec)", () => {
    expect(
      engineWithGrocerySpend(9_000)
        .dangerZone(MONTH_ID)
        .categories.find((c) => c.categoryId === GROCERIES)?.watchLineCents,
    ).toBe(1_000);
  });

  it("available 0 with a plan is watch; no plan is never watchable", () => {
    expect(classifyAvailability(0, 10_000, "BALANCED", defaults)).toBe("watch");
    expect(classifyAvailability(0, 0, "BALANCED", defaults)).toBe("healthy");
    // Spending with nothing assigned is overspent, not watch.
    expect(classifyAvailability(-1, 0, "BALANCED", defaults)).toBe("overspent");
  });
});

// ── fund pace ────────────────────────────────────────────────────────────────

describe("fund pace", () => {
  const paceOf = (balanceCents: number, targetDate = "2027-03-31"): FundPace =>
    computeFundPace(
      {
        id: CAR_FUND,
        targetCents: 120_000,
        targetDate,
        balanceCents,
      },
      { year: 2026, month: 9 },
    ) as FundPace;

  it("seven months of runway: required pace is an exact integer division", () => {
    expect(paceOf(50_000)).toEqual({
      fundId: CAR_FUND,
      gapCents: 70_000,
      monthsRemaining: 7,
      requiredPerMonthCents: 10_000,
      plannedThisMonthCents: null,
      overdue: false,
    });
  });

  it("required pace rounds up (integer ceil-division)", () => {
    expect(paceOf(49_999).requiredPerMonthCents).toBe(10_001);
  });

  it("the deadline month still counts as runway", () => {
    const pace = paceOf(100_000, "2026-09-30");
    expect(pace.monthsRemaining).toBe(1);
    expect(pace.requiredPerMonthCents).toBe(20_000);
    expect(pace.overdue).toBe(false);
  });

  it("a fund past its deadline with the target unmet is overdue", () => {
    const pace = paceOf(50_000, "2026-08-31");
    expect(pace.overdue).toBe(true);
    expect(pace.monthsRemaining).toBe(0);
    expect(pace.requiredPerMonthCents).toBeNull();
    expect(assessFundPace(pace, "AGGRESSIVE", resolveDangerThresholds())).toBe(
      "funding-behind",
    );
  });

  it("a met target is never behind, even overdue", () => {
    const pace = paceOf(130_000, "2026-08-31");
    expect(pace.gapCents).toBe(0);
    expect(pace.requiredPerMonthCents).toBe(0);
    expect(assessFundPace(pace, "CAUTIOUS", resolveDangerThresholds())).toBe(
      "healthy",
    );
  });

  it("funds without a target or a target date have no pace", () => {
    expect(
      computeFundPace(
        { id: "f1", balanceCents: 1_000 },
        { year: 2026, month: 9 },
      ),
    ).toBeNull();
    expect(
      computeFundPace(
        { id: "f2", targetCents: 5_000, balanceCents: 0 },
        { year: 2026, month: 9 },
      ),
    ).toBeNull();
  });

  it("pace slack scales with appetite (required 10_000 this month)", () => {
    const thresholds = resolveDangerThresholds();
    const pace = paceOf(50_000);
    expect(
      assessFundPace(
        { ...pace, plannedThisMonthCents: 9_900 },
        "CAUTIOUS",
        thresholds,
      ),
    ).toBe("funding-behind");
    expect(
      assessFundPace(
        { ...pace, plannedThisMonthCents: 9_900 },
        "BALANCED",
        thresholds,
      ),
    ).toBe("healthy");
    expect(
      assessFundPace(
        { ...pace, plannedThisMonthCents: 9_000 },
        "BALANCED",
        thresholds,
      ),
    ).toBe("healthy");
    expect(
      assessFundPace(
        { ...pace, plannedThisMonthCents: 8_999 },
        "BALANCED",
        thresholds,
      ),
    ).toBe("funding-behind");
    expect(
      assessFundPace(
        { ...pace, plannedThisMonthCents: 7_500 },
        "AGGRESSIVE",
        thresholds,
      ),
    ).toBe("healthy");
    expect(
      assessFundPace(
        { ...pace, plannedThisMonthCents: 7_499 },
        "AGGRESSIVE",
        thresholds,
      ),
    ).toBe("funding-behind");
  });

  it("a fund with no companion category is assessed on deadline breach only", () => {
    const thresholds = resolveDangerThresholds();
    const pace = paceOf(50_000);
    expect(
      assessFundPace(
        { ...pace, plannedThisMonthCents: null },
        "CAUTIOUS",
        thresholds,
      ),
    ).toBe("healthy");
  });
});

// ── the composed engine view ─────────────────────────────────────────────────

describe("dangerZone view", () => {
  it("defaults the household appetite to BALANCED when the state omits it", () => {
    const report = engineWithGrocerySpend(9_100).dangerZone(MONTH_ID);
    expect(report.riskAppetite).toBe("BALANCED");
    // available 900 vs BALANCED line 1_000 → watch (CAUTIOUS would also watch,
    // AGGRESSIVE would not — pinned by the boundary sweeps above).
    expect(report.overall).toBe("watch");
  });

  it("honors the state's appetite and lets a per-call override win", () => {
    const engine = engineWithGrocerySpend(9_100, { riskAppetite: "CAUTIOUS" });
    expect(engine.dangerZone(MONTH_ID).riskAppetite).toBe("CAUTIOUS");
    expect(
      engine.dangerZone(MONTH_ID, { riskAppetite: "AGGRESSIVE" }).riskAppetite,
    ).toBe("AGGRESSIVE");
    expect(
      engine.dangerZone(MONTH_ID, { riskAppetite: "AGGRESSIVE" }).overall,
    ).toBe("healthy");
  });

  it("carries pace facts on the companion category's row", () => {
    const engine = engineWithGrocerySpend(0);
    engine.assign(MONTH_ID, CAR, 10_000);
    const car = engine
      .dangerZone(MONTH_ID)
      .categories.find((c) => c.categoryId === CAR);
    expect(car?.fundPace).toEqual({
      fundId: CAR_FUND,
      gapCents: 70_000,
      monthsRemaining: 7,
      requiredPerMonthCents: 10_000,
      plannedThisMonthCents: 10_000,
      overdue: false,
    });
    expect(car?.state).toBe("healthy");
  });

  it("rolls the overall state up as the worst row", () => {
    // watch + healthy → watch
    expect(engineWithGrocerySpend(9_000).dangerZone(MONTH_ID).overall).toBe(
      "watch",
    );
    // overspent beats funding-behind
    const engine = engineWithGrocerySpend(10_001);
    engine.assign(MONTH_ID, CAR, 8_900); // behind pace under BALANCED
    const report = engine.dangerZone(MONTH_ID);
    expect(report.overall).toBe("overspent");
  });

  it("surfaces an overdue standalone fund in overall without a category row", () => {
    const engine = createBudgetEngine(
      baseState({
        funds: [
          {
            id: "fund-emergency",
            householdId: "h1",
            kind: "STATIC",
            name: "Emergency",
            targetCents: 100_000,
            targetDate: "2026-08-31",
            balanceCents: 40_000,
          },
        ],
        categories: [
          {
            id: GROCERIES,
            householdId: "h1",
            group: "NEEDS",
            name: "Groceries",
          },
        ],
      }),
    );
    engine.assign(MONTH_ID, GROCERIES, 10_000);
    const report = engine.dangerZone(MONTH_ID);
    expect(report.funds).toHaveLength(1);
    expect(report.funds[0].state).toBe("funding-behind");
    expect(
      report.categories.find((c) => c.categoryId === GROCERIES)?.state,
    ).toBe("healthy");
    expect(report.overall).toBe("funding-behind");
  });

  it("omits funds without a target + target date from the report", () => {
    const engine = createBudgetEngine(
      baseState({
        funds: [
          {
            id: "fund-open",
            householdId: "h1",
            kind: "SINKING",
            name: "Someday car",
            balanceCents: 25_000,
          },
        ],
      }),
    );
    expect(engine.dangerZone(MONTH_ID).funds).toEqual([]);
    expect(engine.dangerZone(MONTH_ID).overall).toBe("healthy");
  });

  it("throws UNKNOWN_MONTH for a month the state does not cover", () => {
    const engine = engineWithGrocerySpend(0);
    try {
      engine.dangerZone("m-nope");
      expect.unreachable("expected EngineError");
    } catch (error) {
      expect((error as EngineError).code).toBe("UNKNOWN_MONTH");
    }
  });
});

// ── tunable thresholds ───────────────────────────────────────────────────────

describe("threshold tuning", () => {
  it("merges per-knob, per-appetite overrides over the defaults", () => {
    const thresholds = resolveDangerThresholds({
      watchPercent: { BALANCED: 30 },
      paceFloorPercent: { AGGRESSIVE: 50 },
    });
    expect(thresholds.watchPercent).toEqual({
      CAUTIOUS: 25,
      BALANCED: 30,
      AGGRESSIVE: 5,
    });
    expect(thresholds.paceFloorPercent).toEqual({
      CAUTIOUS: 100,
      BALANCED: 90,
      AGGRESSIVE: 50,
    });
  });

  it("a raised watch line flips the same availability to watch", () => {
    const engine = engineWithGrocerySpend(7_000); // 30% of assigned available
    const tuned = engine.dangerZone(MONTH_ID, {
      thresholds: { watchPercent: { BALANCED: 30 } },
    });
    expect(tuned.overall).toBe("watch");
    expect(engine.dangerZone(MONTH_ID).overall).toBe("healthy");
  });

  it.each([-1, 101, 10.5] as Array<number>)(
    "rejects invalid watchPercent %f",
    (bad) => {
      try {
        resolveDangerThresholds({ watchPercent: { BALANCED: bad } });
        expect.unreachable("expected EngineError");
      } catch (error) {
        expect((error as EngineError).code).toBe("INVALID_DANGER_THRESHOLD");
      }
    },
  );

  it.each([-3, 200, 99.5] as Array<number>)(
    "rejects invalid paceFloorPercent %f",
    (bad) => {
      try {
        resolveDangerThresholds({ paceFloorPercent: { CAUTIOUS: bad } });
        expect.unreachable("expected EngineError");
      } catch (error) {
        expect((error as EngineError).code).toBe("INVALID_DANGER_THRESHOLD");
      }
    },
  );
});

// ── severity rollup primitive ────────────────────────────────────────────────

describe("worstDangerState", () => {
  it.each([
    ["healthy", "healthy", "healthy"],
    ["healthy", "watch", "watch"],
    ["watch", "funding-behind", "funding-behind"],
    ["funding-behind", "overspent", "overspent"],
    ["overspent", "healthy", "overspent"],
  ] as Array<[DangerState, DangerState, DangerState]>)(
    "worst(%s, %s) = %s",
    (a, b, expected) => {
      expect(worstDangerState(a, b)).toBe(expected);
      expect(worstDangerState(b, a)).toBe(expected);
    },
  );
});
