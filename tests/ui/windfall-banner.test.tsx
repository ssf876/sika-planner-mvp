import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WindfallApplyResult } from "@/app/actions/windfall";
import { WindfallBanner } from "@/app/planner/windfall-banner";
import type {
  WindfallDetection,
  WindfallIncomeRow,
  WindfallRankContext,
} from "@/lib/planner/windfall";

const applyWindfallLineAction = vi.fn<
  (monthId: string, line: unknown) => Promise<WindfallApplyResult>
>(async () => ({ ok: true, error: null }));

vi.mock("@/app/actions/windfall", () => ({
  applyWindfallLineAction: (monthId: string, line: unknown) =>
    applyWindfallLineAction(monthId, line),
}));

const monthId = "month-1";

const incomeRows: WindfallIncomeRow[] = [
  {
    transactionId: "tx-payroll",
    payee: "Acme payroll",
    amountCents: 500000,
    date: "2026-09-01",
  },
  {
    transactionId: "tx-stripe",
    payee: "Stripe payout",
    amountCents: 75000,
    date: "2026-09-12",
  },
];

const detection: WindfallDetection = {
  windfallCents: 75000,
  flaggedTransactionIds: ["tx-stripe"],
};

const rankContext: WindfallRankContext = {
  monthId,
  asOf: { year: 2026, month: 9 },
  riskAppetite: "BALANCED",
  categories: [
    {
      categoryId: "cat-groceries",
      name: "Groceries",
      availableCents: -8000,
    },
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
  ],
  goal: {
    goalId: "goal-1",
    name: "Pay off credit card",
    kind: "PAYOFF_DEBT",
    targetCents: 15000,
    suggestedCategoryId: "cat-debt",
  },
};

function renderBanner(
  overrides: Partial<Parameters<typeof WindfallBanner>[0]> = {},
) {
  return render(
    <WindfallBanner
      monthId={monthId}
      incomeRows={incomeRows}
      detection={detection}
      expectedIncomeCents={500000}
      rankContext={rankContext}
      onAvailabilitySync={() => {}}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  applyWindfallLineAction.mockClear();
  applyWindfallLineAction.mockResolvedValue({ ok: true, error: null });
});

describe("WindfallBanner — the Allocate-windfall advisor surface", () => {
  it("lists income rows with a manual Allocate action and flags the unexpected one", () => {
    renderBanner();

    expect(
      screen.getByRole("button", { name: "Allocate Acme payroll" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Allocate Stripe payout" }),
    ).toBeInTheDocument();

    const unexpectedRow = screen.getByTestId("windfall-row-tx-stripe");
    expect(
      within(unexpectedRow).getByText("Unexpected income"),
    ).toBeInTheDocument();
    const payrollRow = screen.getByTestId("windfall-row-tx-payroll");
    expect(within(payrollRow).queryByText("Unexpected income")).toBeNull();
  });

  it("offers the detected windfall as a one-click allocation", async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Allocate windfall" }));

    expect(
      screen.getByText("Suggested plan for $750.00"),
    ).toBeInTheDocument();
  });

  it("renders the ranked proposal: overspent category, then fund, then goal, then remainder", async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(
      screen.getByRole("button", { name: "Allocate Stripe payout" }),
    );

    const proposal = screen.getByTestId("windfall-proposal");
    const lineIds = within(proposal)
      .getAllByTestId(/^windfall-line-/)
      .map((node) => node.getAttribute("data-testid"));
    expect(lineIds).toEqual([
      "windfall-line-windfall:category:cat-groceries",
      "windfall-line-windfall:fund:fund-ef",
      "windfall-line-windfall:goal:goal-1",
      "windfall-line-windfall:remainder",
    ]);
  });

  it("shows the auto-flag hint with the expected-income comparison", () => {
    renderBanner();
    expect(
      screen.getByText(
        /more than the \$5,000\.00 you expected/,
      ),
    ).toBeInTheDocument();
  });

  it("applies a suggested line through the server action and drops it from the plan", async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(
      screen.getByRole("button", { name: "Allocate Stripe payout" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Apply Groceries suggestion" }),
    );

    await waitFor(() =>
      expect(applyWindfallLineAction).toHaveBeenCalledWith(
        monthId,
        expect.objectContaining({
          kind: "category",
          categoryId: "cat-groceries",
        }),
      ),
    );
    expect(
      screen.queryByTestId("windfall-line-windfall:category:cat-groceries"),
    ).toBeNull();
    // The rest of the plan — including the remainder — stays visible.
    expect(
      screen.getByTestId("windfall-line-windfall:remainder"),
    ).toBeInTheDocument();
  });

  it("surfaces the action's error when a line cannot be applied", async () => {
    applyWindfallLineAction.mockResolvedValue({
      ok: false,
      error: "That suggestion is no longer valid — refresh the planner.",
    });
    const user = userEvent.setup();
    renderBanner();

    await user.click(
      screen.getByRole("button", { name: "Allocate Stripe payout" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Apply Groceries suggestion" }),
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(
      "That suggestion is no longer valid — refresh the planner.",
    );
  });

  it("renders nothing when the month has no income rows", () => {
    const { container } = renderBanner({ incomeRows: [] });
    expect(container).toBeEmptyDOMElement();
  });
});
