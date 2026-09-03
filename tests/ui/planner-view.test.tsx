import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlannerActionResult } from "@/app/actions/planner";
import { PlannerView } from "@/app/planner/planner-view";
import type { CategoryAvailable } from "@/src/engine";

const assignCategoryAction = vi.fn<
  (
    monthId: string,
    categoryId: string,
    amount: string,
  ) => Promise<PlannerActionResult>
>(async () => ({ ok: true, error: null }));
const copyPreviousMonthAction = vi.fn<
  (monthId: string) => Promise<PlannerActionResult>
>(async () => ({ ok: true, error: null }));
vi.mock("@/app/actions/planner", () => ({
  assignCategoryAction: (...args: [string, string, string]) =>
    assignCategoryAction(...args),
  copyPreviousMonthAction: (...args: [string]) =>
    copyPreviousMonthAction(...args),
}));

const monthId = "month-1";

const categories = [
  { id: "cat-groceries", name: "Groceries", group: "NEEDS" as const },
  { id: "cat-dining", name: "Dining Out", group: "WANTS" as const },
];

const availability: CategoryAvailable[] = [
  {
    categoryId: "cat-groceries",
    assignedCents: 10000,
    spentCents: 12000,
    cashflowReleasedCents: 0,
    availableCents: -2000,
  },
  {
    categoryId: "cat-dining",
    assignedCents: 5000,
    spentCents: 0,
    cashflowReleasedCents: 0,
    availableCents: 5000,
  },
];

beforeEach(() => {
  assignCategoryAction.mockClear();
  copyPreviousMonthAction.mockClear();
  assignCategoryAction.mockResolvedValue({ ok: true, error: null });
  copyPreviousMonthAction.mockResolvedValue({ ok: true, error: null });
});

function renderPlanner(
  overrides: Partial<Parameters<typeof PlannerView>[0]> = {},
) {
  return render(
    <PlannerView
      monthId={monthId}
      incomeReceivedCents={20000}
      hasPreviousMonth={true}
      categories={categories}
      initialAvailability={availability}
      {...overrides}
    />,
  );
}

function groceriesRow() {
  const input = screen.getByLabelText("Assign Groceries");
  const row = input.closest("tr");
  if (!row) throw new Error("Groceries row not found");
  return row;
}

describe("PlannerView", () => {
  it("renders the Ready to Assign indicator, group sections, and per-row figures", () => {
    renderPlanner();

    // Income received (200.00) minus assigned (100.00 + 50.00).
    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent("$50.00");
    expect(
      screen.getByRole("button", { name: "Copy last month's assignments" }),
    ).toBeEnabled();

    expect(
      screen.getByRole("columnheader", { name: "Category" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Needs")).toBeInTheDocument();
    expect(screen.getByText("Wants")).toBeInTheDocument();

    const groceries = groceriesRow();
    expect(within(groceries).getByText("$120.00")).toBeInTheDocument(); // spent
    expect(within(groceries).getByText("-$20.00")).toBeInTheDocument(); // available
  });

  it("updates the Ready to Assign indicator as an assignment is typed, then saves through the action", async () => {
    const user = userEvent.setup();
    renderPlanner();

    const input = screen.getByLabelText("Assign Groceries");
    await user.clear(input);
    await user.type(input, "150.00");

    // Draft (150.00) replaces the saved 100.00: 200.00 − 150.00 − 50.00 = 0.
    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent("$0.00");
    expect(screen.getByText("Every dollar assigned")).toBeInTheDocument();

    await user.click(
      within(groceriesRow()).getByRole("button", { name: "Assign" }),
    );

    expect(assignCategoryAction).toHaveBeenCalledTimes(1);
    expect(assignCategoryAction).toHaveBeenCalledWith(
      monthId,
      "cat-groceries",
      "150.00",
    );

    // Server truth lands: 150.00 assigned − 120.00 spent = 30.00 available.
    expect(await screen.findByText("$30.00")).toBeInTheDocument();
  });

  it("shows the overspent warning on categories that spent past their assignment", () => {
    renderPlanner();

    const groceries = groceriesRow();
    expect(groceries).toHaveClass("overspent");
    expect(within(groceries).getByText("Overspent")).toBeInTheDocument();

    const dining = screen.getByLabelText("Assign Dining Out").closest("tr");
    if (!dining) throw new Error("Dining row not found");
    expect(dining).not.toHaveClass("overspent");
    expect(within(dining).queryByText("Overspent")).not.toBeInTheDocument();
  });

  it("copies last month's plan and adopts the returned server state", async () => {
    const user = userEvent.setup();
    copyPreviousMonthAction.mockResolvedValueOnce({
      ok: true,
      error: null,
      readyToAssignCents: 5500,
      availability: [
        { ...availability[0], assignedCents: 9000, availableCents: -3000 },
        availability[1],
      ],
    });
    renderPlanner();

    await user.click(
      screen.getByRole("button", { name: "Copy last month's assignments" }),
    );

    expect(copyPreviousMonthAction).toHaveBeenCalledTimes(1);
    expect(copyPreviousMonthAction).toHaveBeenCalledWith(monthId);

    // The view recomputes RTA from the copied plan: 200.00 − 90.00 − 50.00.
    expect(await screen.findByText("$60.00")).toBeInTheDocument();
    // Drafts reset to the copied plan (90.00 on Groceries).
    expect(screen.getByLabelText("Assign Groceries")).toHaveValue("90.00");
  });

  it("disables copy-previous-month before any earlier month exists", () => {
    renderPlanner({ hasPreviousMonth: false });

    expect(
      screen.getByRole("button", { name: "Copy last month's assignments" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "No previous month to copy yet — this planner starts fresh.",
      ),
    ).toBeInTheDocument();
  });

  it("surfaces a rejected assignment as an alert", async () => {
    const user = userEvent.setup();
    assignCategoryAction.mockResolvedValueOnce({
      ok: false,
      error: "Enter a valid dollar amount.",
    });
    renderPlanner();

    await user.click(
      within(groceriesRow()).getByRole("button", { name: "Assign" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a valid dollar amount.",
    );
  });

  it("offers the empty state when the household has no categories", () => {
    renderPlanner({ categories: [], initialAvailability: [] });

    expect(
      screen.getByText(/finish onboarding to scaffold your first month/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ready-to-assign")).not.toBeInTheDocument();
  });
});
