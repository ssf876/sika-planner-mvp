import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/app/dashboard/dashboard-view";
import type { LifeEventFormState } from "@/app/actions/life-events";
import type {
  DashboardCategoryRow,
  DashboardSnapshot,
  DashboardTransactionRow,
  LifeEventKind,
} from "@/lib/repositories/dashboard";

const confirmMock = vi.fn<
  (eventId: string) => Promise<LifeEventFormState>
>(async () => ({ error: null, ok: true }));
const dismissMock = vi.fn<
  (eventId: string) => Promise<LifeEventFormState>
>(async () => ({ error: null, ok: true }));

vi.mock("@/app/actions/life-events", () => ({
  confirmLifeEventAction: (eventId: string) => confirmMock(eventId),
  dismissLifeEventAction: (eventId: string) => dismissMock(eventId),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

function categoryRow(
  overrides: Partial<DashboardCategoryRow> & { categoryId: string; name: string },
): DashboardCategoryRow {
  return {
    assignedCents: 40000,
    spentCents: 0,
    availableCents: 40000,
    state: "healthy",
    ...overrides,
  };
}

function transactionRow(
  overrides: Partial<DashboardTransactionRow> & { id: string; payee: string },
): DashboardTransactionRow {
  return {
    date: "2026-09-02",
    dateLabel: "Sep 2",
    amountCents: -2500,
    kind: "EXPENSE",
    category: "Groceries",
    account: "Everyday Checking",
    ...overrides,
  };
}

function snapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    monthId: "month-1",
    year: 2026,
    month: 9,
    monthLabel: "September 2026",
    hasTransactions: true,
    readyToAssignCents: 0,
    budget: { spentCents: 25000, assignedCents: 100000 },
    income: {
      receivedCents: 50000,
      expectedCents: 200000,
      fundDrawCents: 0,
    },
    netWorthCents: 10800000,
    accountCount: 2,
    danger: {
      overall: "healthy",
      watchCount: 0,
      overspentCount: 0,
      fundingBehindCount: 0,
    },
    sections: [
      {
        id: "savings-funds",
        title: "Savings & Funds",
        categories: [
          categoryRow({ categoryId: "cat-buffer", name: "Emergency buffer" }),
        ],
        funds: [
          {
            id: "fund-car",
            name: "Car repairs",
            kind: "SINKING",
            balanceCents: 26000,
            targetCents: 100000,
          },
        ],
      },
      {
        id: "needs",
        title: "Needs",
        categories: [
          categoryRow({
            categoryId: "cat-groceries",
            name: "Groceries",
            spentCents: 4000,
            availableCents: 36000,
          }),
        ],
      },
      {
        id: "wants",
        title: "Wants",
        categories: [
          categoryRow({ categoryId: "cat-dining", name: "Dining Out" }),
        ],
      },
      {
        id: "debts",
        title: "Debts",
        categories: [
          categoryRow({
            categoryId: "cat-debt",
            name: "Debt Payoff",
            state: "overspent",
            spentCents: 45000,
            assignedCents: 40000,
            availableCents: -5000,
          }),
        ],
        debts: [
          { id: "acc-visa", name: "Visa card", owedCents: 81240 },
        ],
      },
      {
        id: "investments",
        title: "Investments",
        categories: [
          categoryRow({ categoryId: "cat-retirement", name: "Retirement" }),
        ],
      },
    ],
    lifeEvents: [],
    recentTransactions: [],
    ...overrides,
  };
}

beforeEach(() => {
  confirmMock.mockClear();
  dismissMock.mockClear();
  refresh.mockClear();
  confirmMock.mockResolvedValue({ error: null, ok: true });
  dismissMock.mockResolvedValue({ error: null, ok: true });
});

// ─── Hero ────────────────────────────────────────────────────────────────────

describe("DashboardView — hero", () => {
  it("renders month, money left, and the spent-of-planned line without a card wrapper", () => {
    render(<DashboardView snapshot={snapshot()} />);

    const hero = screen.getByTestId("hero");
    expect(within(hero).getByText("September 2026")).toBeInTheDocument();
    // money left = assigned − spent = $1,000.00 − $250.00.
    expect(screen.getByTestId("money-left")).toHaveTextContent("$750.00");
    expect(screen.getByTestId("spent-of-planned")).toHaveTextContent(
      "$250.00 spent of $1,000.00 planned",
    );
  });

  it("nudges with the most overspent category, stated as a fact", () => {
    render(
      <DashboardView
        snapshot={{
          ...snapshot(),
          danger: {
            overall: "overspent",
            watchCount: 0,
            overspentCount: 1,
            fundingBehindCount: 0,
          },
        }}
      />,
    );

    // Debt Payoff sits at −$50.00 — the worst row in the fixture.
    expect(screen.getByTestId("hero-nudge")).toHaveTextContent(
      "Debt Payoff is $50.00 over plan.",
    );
  });

  it("nudges on track when the engine report is healthy", () => {
    render(<DashboardView snapshot={snapshot()} />);
    expect(screen.getByTestId("hero-nudge")).toHaveTextContent(
      "You're on track.",
    );
  });

  it("nudges about watch categories without manufacturing a fix", () => {
    render(
      <DashboardView
        snapshot={{
          ...snapshot(),
          danger: {
            overall: "watch",
            watchCount: 2,
            overspentCount: 0,
            fundingBehindCount: 0,
          },
        }}
      />,
    );

    expect(screen.getByTestId("hero-nudge")).toHaveTextContent(
      "You're on track, but 2 categories are close to their limit.",
    );
  });
});

// ─── Render order (spec §Screens: hero → plan → attention → activity) ───────

describe("DashboardView — section order", () => {
  it("renders hero, plan, attention, and recent activity in that order", () => {
    render(
      <DashboardView
        snapshot={{
          ...snapshot(),
          danger: {
            overall: "overspent",
            watchCount: 0,
            overspentCount: 1,
            fundingBehindCount: 0,
          },
        }}
      />,
    );

    const ids = ["hero", "plan", "attention", "recent-activity"].map((id) =>
      screen.getByTestId(id),
    );
    for (let i = 1; i < ids.length; i += 1) {
      expect(
        ids[i - 1].compareDocumentPosition(ids[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        `section "${ids[i].dataset.testid}" must follow "${ids[i - 1].dataset.testid}"`,
      ).toBeTruthy();
    }
  });
});

// ─── Your plan ───────────────────────────────────────────────────────────────

describe("DashboardView — your plan", () => {
  it("groups open category rows under Needs / Wants / Savings & goals", () => {
    render(<DashboardView snapshot={snapshot()} />);

    const needs = screen.getByTestId("plan-group-needs");
    expect(within(needs).getByText("Groceries")).toBeInTheDocument();

    const wants = screen.getByTestId("plan-group-wants");
    expect(within(wants).getByText("Dining Out")).toBeInTheDocument();

    // Savings & goals folds the v1 Savings & Funds and Investments sections.
    const savings = screen.getByTestId("plan-group-savings");
    expect(within(savings).getByText("Emergency buffer")).toBeInTheDocument();
    expect(within(savings).getByText("Retirement")).toBeInTheDocument();
  });

  it("renders each row with the amount left and the spent-of-planned line", () => {
    render(<DashboardView snapshot={snapshot()} />);

    const groceries = within(screen.getByTestId("plan-group-needs"))
      .getByText("Groceries")
      .closest("li");
    expect(groceries).not.toBeNull();
    expect(groceries).toHaveTextContent("$360.00 left");
    expect(groceries).toHaveTextContent(
      "$40.00 spent of $400.00 planned",
    );
    expect(groceries).toHaveAttribute("data-state", "healthy");
  });

  it("marks overspent rows with the muted semantic state and an over amount", () => {
    render(<DashboardView snapshot={snapshot()} />);

    // The new composition doesn't render the Debts section — the overspent
    // fixture row is folded into Savings & goals under its category name.
    const debtRow = within(screen.getByTestId("plan-group-savings"))
      .getByText("Debt Payoff")
      .closest("li");
    expect(debtRow).toHaveAttribute("data-state", "overspent");
    expect(debtRow).toHaveTextContent("$50.00 over");
  });

  it("surfaces Ready to Assign as a quiet link while unassigned, else the balanced line", () => {
    const { unmount } = render(
      <DashboardView snapshot={snapshot({ readyToAssignCents: 45000 })} />,
    );
    const rta = screen.getByTestId("ready-to-assign");
    expect(rta).toHaveTextContent("$450.00 ready to assign");
    expect(rta).toHaveAttribute("href", "/planner");
    unmount();

    render(<DashboardView snapshot={snapshot()} />);
    expect(screen.getByTestId("plan-balanced")).toHaveTextContent(
      "Your plan is balanced.",
    );
  });

  it("leaves the removed v1 chrome out of the composition", () => {
    render(<DashboardView snapshot={snapshot()} />);

    expect(screen.queryByTestId("net-worth")).not.toBeInTheDocument();
    expect(screen.queryByTestId("income-line")).not.toBeInTheDocument();
    expect(screen.queryByTestId("danger-strip")).not.toBeInTheDocument();
    // Fund rows and their "Open" links, debt rows: not rendered.
    expect(screen.queryByText("Car repairs")).not.toBeInTheDocument();
    expect(screen.queryByText("Visa card")).not.toBeInTheDocument();
    expect(screen.queryByText("$812.40 owed")).not.toBeInTheDocument();
    expect(screen.queryByText(/sinking fund/)).not.toBeInTheDocument();
  });

  it("shows quiet empty lines for groups with nothing planned", () => {
    render(
      <DashboardView
        snapshot={{
          ...snapshot(),
          sections: snapshot().sections.map((section) => ({
            ...section,
            categories: [],
          })),
        }}
      />,
    );

    expect(screen.getAllByText("Nothing planned here yet.")).toHaveLength(3);
  });
});

// ─── Attention ───────────────────────────────────────────────────────────────

describe("DashboardView — attention", () => {
  it("stays out of the page when nothing needs eyes", () => {
    render(<DashboardView snapshot={snapshot()} />);

    expect(screen.queryByTestId("attention")).not.toBeInTheDocument();
  });

  it("summarizes the danger verdict with a planner action, no alert-system copy", () => {
    render(
      <DashboardView
        snapshot={{
          ...snapshot(),
          danger: {
            overall: "overspent",
            watchCount: 0,
            overspentCount: 1,
            fundingBehindCount: 0,
          },
        }}
      />,
    );

    const attention = screen.getByTestId("attention");
    expect(
      within(attention).getByText(
        "Sika found something that needs attention.",
      ),
    ).toBeInTheDocument();
    const action = within(attention).getByRole("link", {
      name: "Move money to cover it in the planner",
    });
    expect(action).toHaveAttribute("href", "/planner");
  });

  it("keeps watch quiet — the hero nudge carries it, no card is earned", () => {
    render(
      <DashboardView
        snapshot={{
          ...snapshot(),
          danger: {
            overall: "watch",
            watchCount: 1,
            overspentCount: 0,
            fundingBehindCount: 0,
          },
        }}
      />,
    );

    expect(screen.queryByTestId("attention")).not.toBeInTheDocument();
  });

  it("renders advisor candidates with their confirmation gate intact", async () => {
    const user = userEvent.setup();
    render(
      <DashboardView
        snapshot={{
          ...snapshot(),
          lifeEvents: [
            {
              id: "event-1",
              kind: "MOVE" as LifeEventKind,
              evidence: "4 transactions matching movers/storage in 3 weeks",
            },
          ],
        }}
      />,
    );

    const block = screen.getByTestId("life-events");
    expect(
      within(block).getByText("Planning around something new?"),
    ).toBeInTheDocument();
    expect(
      within(block).getByText(
        "4 transactions matching movers/storage in 3 weeks",
      ),
    ).toBeInTheDocument();

    await user.click(within(block).getByRole("button", { name: "Confirm" }));
    expect(confirmMock).toHaveBeenCalledWith("event-1");
    expect(refresh).toHaveBeenCalled();

    await user.click(within(block).getByRole("button", { name: "Not now" }));
    expect(dismissMock).toHaveBeenCalledWith("event-1");
  });

  it("surfaces action failures instead of swallowing them", async () => {
    const user = userEvent.setup();
    confirmMock.mockResolvedValue({
      error: "That life event no longer needs a decision — refresh the dashboard.",
      ok: false,
    });
    render(
      <DashboardView
        snapshot={{
          ...snapshot(),
          lifeEvents: [
            { id: "event-2", kind: "CHILD" as LifeEventKind, evidence: null },
          ],
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That life event no longer needs a decision",
    );
  });
});

// ─── Recent activity ─────────────────────────────────────────────────────────

describe("DashboardView — recent activity", () => {
  it("renders payee, signed amount, category, account, and date", () => {
    render(
      <DashboardView
        snapshot={{
          ...snapshot(),
          recentTransactions: [
            transactionRow({ id: "tx-1", payee: "Corner Grocer" }),
            transactionRow({
              id: "tx-2",
              payee: "Acme Payroll",
              amountCents: 500000,
              kind: "INCOME",
              category: null,
              date: "2026-09-01",
              dateLabel: "Sep 1",
            }),
          ],
        }}
      />,
    );

    const list = screen.getByTestId("activity-list");
    const grocer = within(list)
      .getByText("Corner Grocer")
      .closest("li");
    expect(grocer).toHaveTextContent("-$25.00");
    expect(grocer).toHaveTextContent("Groceries · Everyday Checking · Sep 2");

    const payroll = within(list).getByText("Acme Payroll").closest("li");
    expect(payroll).toHaveTextContent("+$5,000.00");
    // No category → the line skips it instead of printing a gap.
    expect(payroll).toHaveTextContent("Everyday Checking · Sep 1");
  });

  it("renders rows newest-first, exactly as the snapshot hands them over", () => {
    render(
      <DashboardView
        snapshot={{
          ...snapshot(),
          recentTransactions: [
            transactionRow({ id: "tx-new", payee: "Apthorp Diner" }),
            transactionRow({ id: "tx-mid", payee: "Fresh Market" }),
            transactionRow({ id: "tx-old", payee: "Acme Payroll" }),
          ],
        }}
      />,
    );

    const payees = within(screen.getByTestId("activity-list"))
      .getAllByRole("listitem")
      .map((item) => within(item).getAllByText(/.+/)[0]?.textContent);
    expect(payees).toEqual(["Apthorp Diner", "Fresh Market", "Acme Payroll"]);
  });

  it("keeps a designed empty state when nothing has been recorded", () => {
    render(<DashboardView snapshot={snapshot()} />);

    expect(screen.getByTestId("activity-empty")).toHaveTextContent(
      "Nothing yet — spending you record shows up here.",
    );
  });
});

// ─── Zero-transaction empty state ────────────────────────────────────────────

describe("DashboardView — empty dashboard", () => {
  it("keeps the product's structure: ready-to-plan hero, plan groups, quiet empties", () => {
    render(<DashboardView snapshot={snapshot({ hasTransactions: false })} />);

    // Hero reads the amount ready to plan, with the one CTA.
    const hero = screen.getByTestId("hero");
    expect(hero).toHaveAttribute("data-empty");
    expect(screen.getByTestId("ready-to-plan")).toHaveTextContent("$2,000.00");
    const cta = within(hero).getByRole("link", { name: "Plan the month" });
    expect(cta).toHaveAttribute("href", "/planner");

    // The plan still shows its groups; the activity glimpse keeps its state.
    expect(screen.getByTestId("plan-group-needs")).toBeInTheDocument();
    expect(screen.getByTestId("activity-empty")).toBeInTheDocument();

    // No giant instructional card, no spending-driven chrome.
    expect(
      screen.queryByText("Your dashboard fills in as money moves"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("danger-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("attention")).not.toBeInTheDocument();
    expect(screen.queryByTestId("money-left")).not.toBeInTheDocument();
  });

  it("lets a life-event candidate appear quietly without dominating", () => {
    render(
      <DashboardView
        snapshot={{
          ...snapshot(),
          hasTransactions: false,
          lifeEvents: [
            { id: "event-3", kind: "MOVE" as LifeEventKind, evidence: null },
          ],
        }}
      />,
    );

    expect(screen.getByTestId("life-events")).toBeInTheDocument();
    // Still no oversized instructional block — the hero stays "ready to plan".
    expect(screen.getByTestId("ready-to-plan")).toBeInTheDocument();
  });
});
