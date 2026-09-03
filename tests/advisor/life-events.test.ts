import { describe, expect, it } from "vitest";

import {
  LIFE_EVENT_RULE_PACKS,
  detectLifeEventCandidates,
  type ConfirmedExpenseRow,
  type LifeEventCandidate,
  type PriorLifeEventRow,
} from "@/src/advisor";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function expense(
  payee: string,
  amountCents: number,
  date: string,
  index = 0,
): ConfirmedExpenseRow {
  return { transactionId: `tx-${index}`, payee, amountCents, date };
}

function prior(
  kind: PriorLifeEventRow["kind"],
  status: PriorLifeEventRow["status"],
  seasonStart: string | null,
): PriorLifeEventRow {
  return { kind, status, seasonStart };
}

function kindsOf(candidates: LifeEventCandidate[]): string[] {
  return candidates.map((candidate) => candidate.kind);
}

describe("detectLifeEventCandidates — MOVE rule pack", () => {
  const today = "2026-09-10"; // 30-day window: Aug 12 … Sep 10

  it("fires when moving-related spending reaches the velocity threshold", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [
        expense("Whole Foods Market", -9500, "2026-08-20"),
        expense("U-Haul Moving", -12900, "2026-08-30", 1),
        expense("Self Storage Plus", -8900, "2026-09-03", 2),
      ],
      priorEvents: [],
      today,
    });

    expect(kindsOf(candidates)).toEqual(["MOVE"]);
    expect(candidates[0]).toMatchObject({
      seasonStart: "2026-08-12",
      evidence:
        '2 moving-related transactions in 30 days — "U-Haul Moving" (Aug 30), "Self Storage Plus" (Sep 3)',
    });
  });

  it("stays quiet when the same spending falls outside the window", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [
        expense("U-Haul Moving", -12900, "2026-06-30"),
        expense("Self Storage Plus", -8900, "2026-07-05", 1),
      ],
      priorEvents: [],
      today,
    });
    expect(candidates).toEqual([]);
  });

  it("needs the threshold — one mover inside the window is not a season", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [expense("Two Men and a Truck", -25000, "2026-09-01")],
      priorEvents: [],
      today,
    });
    expect(candidates).toEqual([]);
  });

  it("matches keywords at word boundaries — 'Restore' is not 'storage'", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [
        expense("Restore Hardware Co", -4500, "2026-09-01"),
        expense("The Whitespace Gallery", -6500, "2026-09-02", 1),
      ],
      priorEvents: [],
      today,
    });
    expect(candidates).toEqual([]);
  });
});

describe("detectLifeEventCandidates — HOME_PURCHASE rule pack", () => {
  const today = "2026-09-10"; // 45-day window: Jul 28 … Sep 10

  it("fires on a burst of housing payments inside the window", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [
        expense("Fairfield Title Co", -25000, "2026-08-20"),
        expense("First National Mortgage", -180000, "2026-09-01", 1),
      ],
      priorEvents: [],
      today,
    });

    expect(kindsOf(candidates)).toEqual(["HOME_PURCHASE"]);
    expect(candidates[0]?.seasonStart).toBe("2026-07-28");
    expect(candidates[0]?.evidence).toContain(
      "2 housing-related transactions in 45 days",
    );
  });

  it("fires on a single large closing-cost wire alone", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [expense("Fairfield Title Co", -1_240_000, "2026-09-01")],
      priorEvents: [],
      today,
    });

    expect(kindsOf(candidates)).toEqual(["HOME_PURCHASE"]);
    expect(candidates[0]?.evidence).toBe(
      'Large housing payment — "Fairfield Title Co" for $12,400.00 on Sep 1',
    );
  });

  it("stays quiet on small routine housing costs", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [
        expense("HOA Fee", -3500, "2026-08-15"),
        expense("Acme Rent", -180000, "2026-09-01", 1),
      ],
      priorEvents: [],
      today,
    });
    // HOA matches but is small; "Acme Rent" matches no pack keyword —
    // velocity (1 < 2) and the large-payment trigger both fall short.
    expect(candidates).toEqual([]);
  });

  it("ignores a large housing payment outside the window", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [expense("Fairfield Title Co", -1_240_000, "2026-05-01")],
      priorEvents: [],
      today,
    });
    expect(candidates).toEqual([]);
  });
});

describe("detectLifeEventCandidates — WEDDING rule pack", () => {
  const today = "2026-09-10";

  it("fires on a spread of wedding vendors inside the window", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [
        expense("Rosewood Venue", -350000, "2026-08-14"),
        expense("Bloom Bridal Shop", -98000, "2026-08-25", 1),
        expense("Hartley Photographers", -150000, "2026-09-06", 2),
      ],
      priorEvents: [],
      today,
    });

    expect(kindsOf(candidates)).toEqual(["WEDDING"]);
    expect(candidates[0]?.evidence).toContain(
      "3 wedding-related transactions in 45 days",
    );
  });

  it("stays quiet below the vendor threshold — two vendors is not a season", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [
        expense("Rosewood Venue", -350000, "2026-08-14"),
        expense("Bloom Bridal Shop", -98000, "2026-08-25", 1),
      ],
      priorEvents: [],
      today,
    });
    expect(candidates).toEqual([]);
  });
});

describe("detectLifeEventCandidates — CHILD rule pack", () => {
  const today = "2026-09-10";

  it("fires on recurring childcare spending inside the window", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [
        expense("Little Sprouts Daycare", -96000, "2026-08-18"),
        expense("Dr Tran Pediatrician", -15000, "2026-09-02", 1),
      ],
      priorEvents: [],
      today,
    });

    expect(kindsOf(candidates)).toEqual(["CHILD"]);
    expect(candidates[0]?.evidence).toContain(
      "2 childcare-related transactions in 45 days",
    );
  });

  it("stays quiet on ordinary family spending", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [
        expense("Whole Foods Market", -9500, "2026-08-18"),
        expense("Toys For Tots Emporium", -4200, "2026-09-02", 1),
      ],
      priorEvents: [],
      today,
    });
    expect(candidates).toEqual([]);
  });
});

describe("detectLifeEventCandidates — suppression (dismiss → rule suppressed)", () => {
  const confirmed = [
    expense("U-Haul Moving", -12900, "2026-08-30"),
    expense("Self Storage Plus", -8900, "2026-09-03", 1),
  ];
  const today = "2026-09-10";

  it("never re-candidates a kind with an open candidate", () => {
    const candidates = detectLifeEventCandidates({
      confirmed,
      priorEvents: [prior("MOVE", "CANDIDATE", "2026-08-12")],
      today,
    });
    expect(kindsOf(candidates)).toEqual([]);
  });

  it("never re-candidates a kind with a confirmed season", () => {
    const candidates = detectLifeEventCandidates({
      confirmed,
      priorEvents: [prior("MOVE", "CONFIRMED", "2026-08-12")],
      today,
    });
    expect(kindsOf(candidates)).toEqual([]);
  });

  it("suppresses a dismissed rule while the evidence windows can overlap", () => {
    const candidates = detectLifeEventCandidates({
      confirmed,
      priorEvents: [prior("MOVE", "DISMISSED", "2026-08-12")],
      today,
    });
    // Dismissed window runs Aug 12 … Sep 11; today's window (Aug 12 …) still
    // overlaps it, so the rule stays quiet.
    expect(kindsOf(candidates)).toEqual([]);
  });

  it("fires again once fresh spending falls entirely past a dismissal", () => {
    // The old season anchored in July; its 30-day window ended Aug 9, and
    // today's window (Aug 12 …) can no longer see it.
    const candidates = detectLifeEventCandidates({
      confirmed,
      priorEvents: [prior("MOVE", "DISMISSED", "2026-07-10")],
      today,
    });
    expect(kindsOf(candidates)).toEqual(["MOVE"]);
  });

  it("suppression is per kind — a dismissed MOVE never mutes WEDDING", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [
        ...confirmed,
        expense("Rosewood Venue", -350000, "2026-08-14", 2),
        expense("Bloom Bridal Shop", -98000, "2026-08-25", 3),
        expense("Hartley Photographers", -150000, "2026-09-06", 4),
      ],
      priorEvents: [prior("MOVE", "DISMISSED", "2026-08-12")],
      today,
    });
    expect(kindsOf(candidates)).toEqual(["WEDDING"]);
  });
});

describe("detectLifeEventCandidates — determinism and evidence", () => {
  it("is independent of input row order", () => {
    const ordered: ConfirmedExpenseRow[] = [
      expense("U-Haul Moving", -12900, "2026-08-30", 0),
      expense("Self Storage Plus", -8900, "2026-09-03", 1),
    ];
    const shuffled = [ordered[1], ordered[0]];
    const today = "2026-09-10";

    expect(detectLifeEventCandidates({ confirmed: shuffled, priorEvents: [], today })).toEqual(
      detectLifeEventCandidates({ confirmed: ordered, priorEvents: [], today }),
    );
  });

  it("lists at most three payees and marks the overflow with an ellipsis", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [
        expense("U-Haul Moving", -12900, "2026-08-30"),
        expense("Self Storage Plus", -8900, "2026-08-31", 1),
        expense("Boxes R Us", -2400, "2026-09-01", 2),
        expense("Two Men and a Truck", -45000, "2026-09-02", 3),
      ],
      priorEvents: [],
      today: "2026-09-10",
    });

    expect(candidates[0]?.evidence).toBe(
      '4 moving-related transactions in 30 days — "U-Haul Moving" (Aug 30), ' +
        '"Self Storage Plus" (Aug 31), "Boxes R Us" (Sep 1), …',
    );
  });

  it("covers every detectable kind exactly once across the packs", () => {
    expect(LIFE_EVENT_RULE_PACKS.map((pack) => pack.kind)).toEqual([
      "HOME_PURCHASE",
      "MOVE",
      "WEDDING",
      "CHILD",
    ]);
  });

  it("never emits CUSTOM — it exists only as a user declaration", () => {
    const candidates = detectLifeEventCandidates({
      confirmed: [expense("Surprises Inc", -500000, "2026-09-01")],
      priorEvents: [],
      today: "2026-09-10",
    });
    expect(kindsOf(candidates)).not.toContain("CUSTOM");
  });
});
