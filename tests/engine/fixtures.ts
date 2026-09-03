import type { EngineState } from "@/src/engine/types";

// Deterministic household fixture for engine tests.
//
// Accounts: checking $1,000.00 · credit $0 (owed) · cash wallet $50.00
// Categories: groceries, dining (plain) · car-repair (companion of a sinking fund)
// Funds: car-repair SINKING $500.00 · vacation STATIC $1,200.00
// Months: June 2026 ("m-jun") and July 2026 ("m-jul")

export interface FixtureIds {
  householdId: string;
  checkingId: string;
  creditId: string;
  cashId: string;
  groceriesId: string;
  diningId: string;
  carRepairId: string;
  carFundId: string;
  vacationFundId: string;
  monthJunId: string;
  monthJulId: string;
}

export interface Fixture {
  state: EngineState;
  ids: FixtureIds;
}

export function buildFixture(): Fixture {
  const householdId = "hh-1";
  const ids: FixtureIds = {
    householdId,
    checkingId: "acct-checking",
    creditId: "acct-credit",
    cashId: "acct-cash",
    groceriesId: "cat-groceries",
    diningId: "cat-dining",
    carRepairId: "cat-car-repair",
    carFundId: "fund-car-repair",
    vacationFundId: "fund-vacation",
    monthJunId: "m-jun",
    monthJulId: "m-jul",
  };

  const state: EngineState = {
    householdId,
    accounts: [
      {
        id: ids.checkingId,
        householdId,
        kind: "CHECKING",
        name: "Everyday checking",
        startingCents: 100_000,
      },
      {
        id: ids.creditId,
        householdId,
        kind: "CREDIT",
        name: "Rewards card",
        startingCents: 0,
      },
      {
        id: ids.cashId,
        householdId,
        kind: "CASH",
        name: "Cash wallet",
        startingCents: 5_000,
      },
    ],
    categories: [
      { id: ids.groceriesId, householdId, group: "NEEDS", name: "Groceries" },
      { id: ids.diningId, householdId, group: "WANTS", name: "Dining out" },
      {
        id: ids.carRepairId,
        householdId,
        group: "NEEDS",
        name: "Car repair",
        fundId: ids.carFundId,
      },
    ],
    months: [
      {
        id: ids.monthJunId,
        householdId,
        year: 2026,
        month: 6,
        expectedIncomeCents: 320_000,
      },
      {
        id: ids.monthJulId,
        householdId,
        year: 2026,
        month: 7,
        expectedIncomeCents: 320_000,
      },
    ],
    allocations: [],
    transactions: [],
    funds: [
      {
        id: ids.carFundId,
        householdId,
        kind: "SINKING",
        name: "Car repair",
        balanceCents: 50_000,
      },
      {
        id: ids.vacationFundId,
        householdId,
        kind: "STATIC",
        name: "Vacation",
        balanceCents: 120_000,
      },
    ],
    fundDraws: [],
    transfers: [],
  };

  return { state, ids };
}
