import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardView } from "@/app/dashboard/dashboard-view";
import type { LifeEventFormState } from "@/app/actions/life-events";
import type {
  DashboardCategoryRow,
  DashboardSnapshot,
  LifeEventKind,
} from "@/lib/repositories/dashboard";

const confirmMock = vi.fn<
  (eventId: string) => Promise<LifeEventFormState>
>(async () => ({ error: null, ok: true }));
const dismissMock = vi.fn<
  (eventId: string) => Promise<LifeEventFormState>
>(async () => ({ error: null, ok: true }));
const declareMock = vi.fn<
  (kind: string) => Promise<LifeEventFormState>
>(async () => ({ error: null, ok: true }));

vi.mock("@/app/actions/life-events", () => ({
  confirmLifeEventAction: (eventId: string) => confirmMock(eventId),
  dismissLifeEventAction: (eventId: string) => dismissMock(eventId),
  declareLifeEventAction: (kind: string) => declareMock(kind),
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
    ...overrides,
  };
}

beforeEach(() => {
  confirmMock.mockClear();
  dismissMock.mockClear();
  declareMock.mockClear();
  refresh.mockClear();
  confirmMock.mockResolvedValue({ error: null, ok: true });
  dismissMock.mockResolvedValue({ error: null, ok: true });
  declareMock.mockResolvedValue({ error: null, ok: true });
});

// ─── Sections and metrics ────────────────────────────────────────────────────

describe("DashboardView — budget and income", () => {
  it("renders budget progress as $X spent of $Y and the cash-based Ready to Assign", () => {
    render(
      <DashboardView
        snapshot={snapshot({ readyToAssignCents: 45000 })}
      />,
    );

    expect(
      screen.getByText("September 2026 budget — $250.00 spent of $1,000.00"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent(
      "$450.00",
    );
    expect(screen.getByRole("link", { name: "monthly planner" })).toHaveAttribute(
      "href",
      "/planner",
    );
  });

  it("renders income received vs expected", () => {
    render(<DashboardView snapshot={snapshot()} />);

    expect(screen.getByTestId("income-line")).toHaveTextContent(
      "$500.00 received of $2,000.00 expected",
    );
    expect(
      screen.queryByText(/popped up from funds/),
    ).not.toBeInTheDocument();
  });

  it("calls out popped-up fund draws as cashflow, not income", () => {
    render(
      <DashboardView
        snapshot={snapshot({
          income: {
            receivedCents: 50000,
            expectedCents: 200000,
            fundDrawCents: 24000,
          },
        })}
      />,
    );

    expect(
      screen.getByText(/Plus \$240\.00 popped up from funds/),
    ).toBeInTheDocument();
  });

  it("renders net worth across accounts", () => {
    render(<DashboardView snapshot={snapshot()} />);

    expect(screen.getByTestId("net-worth")).toHaveTextContent("$108,000.00");
    expect(screen.getByText(/Across 2 accounts/)).toBeInTheDocument();
  });
});

describe("DashboardView — the five mock-up sections", () => {
  it("renders Savings & Funds with fund balances toward targets", () => {
    render(<DashboardView snapshot={snapshot()} />);

    const section = screen.getByTestId("section-savings-funds");
    expect(section).toHaveTextContent("Savings & Funds");
    expect(section).toHaveTextContent("Emergency buffer");
    expect(section).toHaveTextContent("$260.00 toward $1,000.00");
    expect(section).toHaveTextContent("sinking fund");
  });

  it("renders Needs rows with spent-of-assigned and available amounts", () => {
    render(<DashboardView snapshot={snapshot()} />);

    const section = screen.getByTestId("section-needs");
    expect(section).toHaveTextContent("Groceries");
    expect(section).toHaveTextContent("$40.00 of $400.00");
    expect(section).toHaveTextContent("$360.00 available");
  });

  it("renders Wants rows", () => {
    render(<DashboardView snapshot={snapshot()} />);

    expect(screen.getByTestId("section-wants")).toHaveTextContent(
      "Dining Out",
    );
  });

  it("renders Debts with owed credit accounts and engine danger badges", () => {
    render(<DashboardView snapshot={snapshot()} />);

    const section = screen.getByTestId("section-debts");
    expect(section).toHaveTextContent("Debt Payoff");
    expect(section).toHaveTextContent("$812.40 owed");
    expect(section).toHaveTextContent("Visa card");
    expect(screen.getByText("Overspent")).toBeInTheDocument();
  });

  it("renders Investments rows", () => {
    render(<DashboardView snapshot={snapshot()} />);

    expect(screen.getByTestId("section-investments")).toHaveTextContent(
      "Retirement",
    );
  });

  it("renders the five sections in mock-up order", () => {
    render(<DashboardView snapshot={snapshot()} />);

    const titles = screen
      .getAllByTestId(/^section-/)
      .map((element) => element.querySelector("h2")?.textContent);
    expect(titles).toEqual([
      "Savings & Funds",
      "Needs",
      "Wants",
      "Debts",
      "Investments",
    ]);
  });
});

describe("DashboardView — danger strip", () => {
  it("reads All clear when the engine report is healthy", () => {
    render(<DashboardView snapshot={snapshot()} />);

    expect(screen.getByTestId("danger-strip")).toHaveTextContent(
      "All clear Nothing needs attention right now.",
    );
  });

  it("surfaces the overspent verdict with the failing count", () => {
    render(
      <DashboardView
        snapshot={snapshot({
          danger: {
            overall: "overspent",
            watchCount: 0,
            overspentCount: 1,
            fundingBehindCount: 0,
          },
        })}
      />,
    );

    expect(screen.getByTestId("danger-strip")).toHaveTextContent(
      /Overspent 1 category has spent past the plan/,
    );
  });
});

// ─── Life events card ────────────────────────────────────────────────────────

describe("DashboardView — life events", () => {
  it("shows candidates with evidence and confirms on click", async () => {
    const user = userEvent.setup();
    render(
      <DashboardView
        snapshot={snapshot({
          lifeEvents: [
            {
              id: "event-1",
              kind: "MOVE" as LifeEventKind,
              evidence: "4 transactions matching movers/storage in 3 weeks",
            },
          ],
        })}
      />,
    );

    expect(
      screen.getByText("4 transactions matching movers/storage in 3 weeks"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(confirmMock).toHaveBeenCalledWith("event-1");
    expect(refresh).toHaveBeenCalled();
  });

  it("dismisses a candidate on click", async () => {
    const user = userEvent.setup();
    render(
      <DashboardView
        snapshot={snapshot({
          lifeEvents: [
            { id: "event-2", kind: "WEDDING" as LifeEventKind, evidence: null },
          ],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(dismissMock).toHaveBeenCalledWith("event-2");
  });

  it("surfaces action failures instead of swallowing them", async () => {
    const user = userEvent.setup();
    confirmMock.mockResolvedValue({
      error: "That life event no longer needs a decision — refresh the dashboard.",
      ok: false,
    });
    render(
      <DashboardView
        snapshot={snapshot({
          lifeEvents: [
            { id: "event-3", kind: "CHILD" as LifeEventKind, evidence: null },
          ],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That life event no longer needs a decision",
    );
  });

  it("declares a life change from the picker", async () => {
    const user = userEvent.setup();
    render(<DashboardView snapshot={snapshot()} />);

    await user.selectOptions(
      screen.getByLabelText("Declare a life change"),
      "HOME_PURCHASE",
    );
    await user.click(screen.getByRole("button", { name: "Declare" }));

    expect(declareMock).toHaveBeenCalledWith("HOME_PURCHASE");
  });
});

// ─── Empty states ────────────────────────────────────────────────────────────

describe("DashboardView — empty states", () => {
  it("renders the zero-transaction empty state with a planner link and nothing else", () => {
    render(<DashboardView snapshot={snapshot({ hasTransactions: false })} />);

    expect(screen.getByTestId("dashboard-empty")).toHaveTextContent(
      "Your dashboard fills in as money moves",
    );
    expect(
      screen.getByText(/deplete category availability in real time/),
    ).toBeInTheDocument();

    const plannerLink = screen.getByRole("link", {
      name: "Plan the month →",
    });
    expect(plannerLink).toHaveAttribute("href", "/planner");

    // The spending-driven panels stay out of the way until money moves.
    expect(screen.queryByTestId("danger-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-needs")).not.toBeInTheDocument();
    expect(screen.queryByTestId("net-worth")).not.toBeInTheDocument();
  });

  it("keeps the life events card on the zero-transaction dashboard", () => {
    render(<DashboardView snapshot={snapshot({ hasTransactions: false })} />);

    expect(screen.getByTestId("life-events-card")).toBeInTheDocument();
  });

  it("shows the quiet life-events empty state", () => {
    render(<DashboardView snapshot={snapshot()} />);

    expect(screen.getByTestId("life-events-empty")).toHaveTextContent(
      "Nothing new detected — declare a life change if one just happened.",
    );
  });
});
