import { describe, expect, it } from "vitest";

import {
  buildSeasonProposal,
  type SeasonProposalCategoryRow,
} from "@/src/advisor";

function row(
  name: string,
  group: SeasonProposalCategoryRow["group"],
  assignedCents: number,
): SeasonProposalCategoryRow {
  return {
    categoryId: `cat-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    group,
    assignedCents,
  };
}

describe("buildSeasonProposal — template top-ups", () => {
  it("suggests the NEW month total: current assignment plus the template target", () => {
    const proposal = buildSeasonProposal({
      kind: "CHILD",
      categories: [row("Groceries", "NEEDS", 2_500)],
      readyToAssignCents: 100_000,
    });

    expect(proposal.kind).toBe("CHILD");
    expect(proposal.lines).toHaveLength(1);
    expect(proposal.lines[0]).toMatchObject({
      id: "season:CHILD:cat-groceries",
      categoryId: "cat-groceries",
      suggestedCents: 10_000, // 2,500 current + 7,500 target
    });
    expect(proposal.lines[0]?.reason).toContain("Growing family season");
    expect(proposal.lines[0]?.reason).toContain("(was $25.00)");
  });

  it("skips template lines for categories the household doesn't have", () => {
    const proposal = buildSeasonProposal({
      kind: "CHILD",
      // Only Groceries exists — Insurance and Savings & Funds were renamed away.
      categories: [row("Groceries", "NEEDS", 0)],
      readyToAssignCents: 100_000,
    });

    expect(proposal.lines).toHaveLength(1);
    expect(proposal.lines[0]?.categoryId).toBe("cat-groceries");
  });

  it("uses the generic busy-season template for declared CUSTOM seasons", () => {
    const proposal = buildSeasonProposal({
      kind: "CUSTOM",
      categories: [row("Savings & Funds", "SAVINGS_DEBTS", 0)],
      readyToAssignCents: 100_000,
    });

    expect(proposal.label).toBe("Busy season");
    expect(proposal.lines).toHaveLength(1);
    expect(proposal.lines[0]?.suggestedCents).toBe(10_000);
  });

  it("returns no lines for an empty category set", () => {
    const proposal = buildSeasonProposal({
      kind: "MOVE",
      categories: [],
      readyToAssignCents: 0,
    });
    expect(proposal.lines).toEqual([]);
  });
});

describe("buildSeasonProposal — suggested reallocations", () => {
  it("reallocates from discretionary categories only when Ready-to-Assign falls short", () => {
    const proposal = buildSeasonProposal({
      kind: "CHILD",
      categories: [
        row("Groceries", "NEEDS", 0),
        row("Dining Out", "WANTS", 30_000),
      ],
      readyToAssignCents: 0,
    });

    const reallocation = proposal.lines.find(
      (line) => line.categoryId === "cat-dining-out",
    );
    // Shortfall is the 7,500 Groceries target (other lines skipped); freed
    // money is capped at the template's 7,500 per category.
    expect(reallocation).toMatchObject({
      suggestedCents: 22_500, // 30,000 current − 7,500 freed
      id: "season:CHILD:cat-dining-out",
    });
    expect(reallocation?.reason).toContain("free up $75.00");
    expect(reallocation?.reason).toContain("(was $300.00)");
  });

  it("never reallocates when Ready-to-Assign covers the season", () => {
    const proposal = buildSeasonProposal({
      kind: "CHILD",
      categories: [
        row("Groceries", "NEEDS", 0),
        row("Dining Out", "WANTS", 30_000),
      ],
      readyToAssignCents: 10_000,
    });

    expect(proposal.lines.map((line) => line.categoryId)).toEqual([
      "cat-groceries",
    ]);
  });

  it("respects the per-category cap and spills to the next candidate in name order", () => {
    const proposal = buildSeasonProposal({
      kind: "HOME_PURCHASE",
      categories: [
        row("Rent / Mortgage", "NEEDS", 100_000),
        row("Zoo Fund", "WANTS", 30_000),
        row("Arcade", "WANTS", 30_000),
      ],
      readyToAssignCents: 0,
    });

    // The Rent target (50,000) drives the shortfall — the only resolvable
    // template line. Reallocation caps at 10,000 per WANTS category, Arcade
    // before Zoo Fund alphabetically.
    expect(proposal.lines).toEqual([
      expect.objectContaining({
        categoryId: "cat-rent-/-mortgage",
        suggestedCents: 150_000,
      }),
      expect.objectContaining({
        categoryId: "cat-arcade",
        suggestedCents: 20_000,
        reason: expect.stringContaining("free up $100.00"),
      }),
      expect.objectContaining({
        categoryId: "cat-zoo-fund",
        suggestedCents: 20_000,
        reason: expect.stringContaining("free up $100.00"),
      }),
    ]);
  });

  it("never reallocates a category already on a template line", () => {
    const proposal = buildSeasonProposal({
      kind: "MOVE",
      categories: [
        row("Transportation", "NEEDS", 0),
        row("Dining Out", "WANTS", 30_000), // template line, not a source
        row("Shopping", "WANTS", 5_000), // template line, not a source
        row("Entertainment", "WANTS", 20_000),
      ],
      readyToAssignCents: 0,
    });

    // MOVE targets total 15,000; the only eligible reallocation source is
    // Entertainment, capped at 7,500.
    const reallocation = proposal.lines.find(
      (line) => line.categoryId === "cat-entertainment",
    );
    expect(reallocation).toMatchObject({ suggestedCents: 12_500 });
    // Dining Out appears once — as a top-up, never as a reduction.
    expect(
      proposal.lines.filter((line) => line.categoryId === "cat-dining-out"),
    ).toHaveLength(1);
    expect(
      proposal.lines.find((line) => line.categoryId === "cat-dining-out")
        ?.suggestedCents,
    ).toBe(37_500);
  });

  it("frees at most what a category has, never below zero", () => {
    const proposal = buildSeasonProposal({
      kind: "CHILD",
      categories: [
        row("Groceries", "NEEDS", 0),
        row("Subscriptions", "WANTS", 0), // nothing to free — not a candidate
        row("Entertainment", "WANTS", 2_000), // capped by what it has
      ],
      readyToAssignCents: 0,
    });

    const subscriptions = proposal.lines.find(
      (line) => line.categoryId === "cat-subscriptions",
    );
    expect(subscriptions).toBeUndefined();

    const entertainment = proposal.lines.find(
      (line) => line.categoryId === "cat-entertainment",
    );
    expect(entertainment).toMatchObject({ suggestedCents: 0 }); // freed 2,000
  });

  it("stops reallocating once the shortfall is covered", () => {
    const proposal = buildSeasonProposal({
      kind: "MOVE",
      categories: [
        row("Transportation", "NEEDS", 0),
        row("Dining Out", "WANTS", 30_000),
        row("Shopping", "WANTS", 5_000),
        row("Arcade", "WANTS", 30_000),
        row("Zoo Fund", "WANTS", 30_000),
      ],
      readyToAssignCents: 7_500, // covers part of the 15,000 target
    });

    // Shortfall 7,500 → Arcade frees exactly 7,500, Zoo Fund untouched.
    expect(
      proposal.lines.find((line) => line.categoryId === "cat-zoo-fund"),
    ).toBeUndefined();
    expect(
      proposal.lines.find((line) => line.categoryId === "cat-arcade"),
    ).toMatchObject({ suggestedCents: 22_500 });
  });
});
