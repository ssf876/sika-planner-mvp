import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlannerActionResult } from "@/app/actions/planner";
import { PlannerView } from "@/app/planner/planner-view";
import type { PlannerProposal } from "@/lib/planner/proposals";
import type { CategoryAvailable } from "@/src/engine";

// Models the real action's contract: success returns the updated availability
// so the view can adopt server truth (stale or absent availability is a
// failure branch and keeps the editor open).
const assignCategoryAction = vi.fn<
  (
    monthId: string,
    categoryId: string,
    amount: string,
  ) => Promise<PlannerActionResult>
>(async (_monthId, categoryId, amount) => ({
  ok: true,
  error: null,
  availability: availability.map((a) =>
    a.categoryId === categoryId
      ? { ...a, assignedCents: Math.round(parseFloat(amount) * 100) }
      : a,
  ),
}));
const copyPreviousMonthAction = vi.fn<
  (monthId: string) => Promise<PlannerActionResult>
>(async () => ({ ok: true, error: null, availability }));
const applyProposalAction = vi.fn<
  (monthId: string, proposal: unknown) => Promise<PlannerActionResult>
>(async () => ({ ok: true, error: null }));

vi.mock("@/app/actions/planner", () => ({
  assignCategoryAction: (...args: [string, string, string]) =>
    assignCategoryAction(...args),
  copyPreviousMonthAction: (...args: [string]) =>
    copyPreviousMonthAction(...args),
  applyProposalAction: (...args: [string, unknown]) =>
    applyProposalAction(...args),
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

const proposals: PlannerProposal[] = [
  {
    id: "prop-1",
    categoryId: "cat-dining",
    suggestedCents: 7500,
    reason: "Back-to-school season",
  },
];

beforeEach(() => {
  assignCategoryAction.mockClear();
  copyPreviousMonthAction.mockClear();
  applyProposalAction.mockClear();
  copyPreviousMonthAction.mockResolvedValue({
    ok: true,
    error: null,
    availability,
  });
  applyProposalAction.mockResolvedValue({ ok: true, error: null });
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
      proposals={[]}
      {...overrides}
    />,
  );
}

function categoryRow(name: string): HTMLElement {
  const row = screen.getByText(name, { exact: true }).closest("li");
  if (!row) throw new Error(`${name} row not found`);
  return row;
}

function plannedCell(name: string) {
  return within(categoryRow(name)).getByRole("button", {
    name: `Edit planned amount for ${name}`,
  });
}

// The editor is type="text" + inputMode="decimal" so an invalid draft
// ("abc") can be shown and corrected — its role is textbox.
async function openPlannedEditor(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(plannedCell(name));
  return screen.getByRole("textbox", {
    name: `Planned amount for ${name}`,
  });
}

describe("PlannerView — editorial structure", () => {
  it("renders the Ready to Assign hero, open group sections, and per-row figures", () => {
    renderPlanner();

    // Income received (200.00) minus assigned (100.00 + 50.00).
    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent("$50.00");
    expect(
      screen.getByRole("button", { name: "Copy last month's assignments" }),
    ).toBeEnabled();

    // Open sections, not a spreadsheet grid.
    expect(screen.getByRole("heading", { name: "Needs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wants" })).toBeInTheDocument();

    const groceries = categoryRow("Groceries");
    expect(groceries).toHaveAttribute("data-state", "overspent");
    expect(within(groceries).getByText("$120.00")).toBeInTheDocument(); // spent
    expect(within(groceries).getByText("-$20.00")).toBeInTheDocument(); // left

    const dining = categoryRow("Dining Out");
    expect(dining).toHaveAttribute("data-state", "healthy");
    // Planned and left are both $50.00 here — read the planned figure from
    // the affordance that owns it.
    expect(plannedCell("Dining Out")).toHaveTextContent("$50.00");
  });

  it("keeps the empty month honest — no congratulations for a plan that has not started", () => {
    renderPlanner({
      incomeReceivedCents: 0,
      initialAvailability: availability.map((a) => ({
        ...a,
        assignedCents: 0,
        availableCents: -a.spentCents,
      })),
      proposals: [],
    });

    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent("$0.00");
    expect(
      screen.getByText(
        "Nothing to assign yet — Add this month's income to start your plan.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Every dollar assigned."),
    ).not.toBeInTheDocument();
  });

  it("celebrates a fully assigned month only once income has arrived", () => {
    renderPlanner({ incomeReceivedCents: 15000, proposals: [] });

    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent("$0.00");
    expect(screen.getByText("Every dollar assigned.")).toBeInTheDocument();
    expect(
      screen.queryByText(/Nothing to assign yet/),
    ).not.toBeInTheDocument();
  });

  it("copies last month's plan and adopts the returned server state", async () => {
    const user = userEvent.setup();
    copyPreviousMonthAction.mockResolvedValueOnce({
      ok: true,
      error: null,
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
    expect(plannedCell("Groceries")).toHaveTextContent("$90.00");
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

  it("offers the empty state when the household has no categories", () => {
    renderPlanner({ categories: [], initialAvailability: [] });

    expect(
      screen.getByText(/finish onboarding to scaffold your first month/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ready-to-assign")).not.toBeInTheDocument();
  });
});

describe("PlannerView — inline-edit planned values", () => {
  it("updates Ready to Assign as the draft is typed, then saves through the action", async () => {
    const user = userEvent.setup();
    renderPlanner();

    const input = await openPlannedEditor(user, "Groceries");
    await user.clear(input);
    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent("$150.00");

    await user.type(input, "150.00");
    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent("$0.00");
    expect(assignCategoryAction).not.toHaveBeenCalled();

    await user.type(input, "{Enter}");
    expect(assignCategoryAction).toHaveBeenCalledTimes(1);
    expect(assignCategoryAction).toHaveBeenCalledWith(
      monthId,
      "cat-groceries",
      "150.00",
    );

    // Server truth lands: 150.00 assigned − 120.00 spent = 30.00 available.
    expect(await screen.findByText("$30.00")).toBeInTheDocument();
    // The editor closes back into the value, showing the committed amount.
    expect(
      screen.queryByRole("textbox", { name: "Planned amount for Groceries" }),
    ).not.toBeInTheDocument();
    expect(plannedCell("Groceries")).toHaveTextContent("$150.00");
  });

  it("saves on click-outside and cancels on Escape", async () => {
    const user = userEvent.setup();
    renderPlanner();

    const input = await openPlannedEditor(user, "Groceries");
    await user.clear(input);
    await user.type(input, "120.00");
    await user.click(screen.getByText("Ready to assign"));
    // Click-outside commits through the same action; the editor closes back
    // into the value and server truth lands (120.00 − 120.00 spent = 0.00).
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(assignCategoryAction).toHaveBeenCalledWith(
      monthId,
      "cat-groceries",
      "120.00",
    );
    expect(
      screen.queryByRole("textbox", { name: "Planned amount for Groceries" }),
    ).not.toBeInTheDocument();
    expect(plannedCell("Groceries")).toHaveTextContent("$120.00");

    // Escape restores the saved value without calling the action.
    const diningInput = await openPlannedEditor(user, "Dining Out");
    await user.clear(diningInput);
    await user.type(diningInput, "250.00");
    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent(
      "-$170.00",
    );
    await user.type(diningInput, "{Escape}");
    expect(
      screen.queryByRole("textbox", { name: "Planned amount for Dining Out" }),
    ).not.toBeInTheDocument();
    expect(assignCategoryAction).not.toHaveBeenCalledWith(
      monthId,
      "cat-dining",
      "250.00",
    );
    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent("$30.00");
    expect(plannedCell("Dining Out")).toHaveTextContent("$50.00");
  });

  it("is keyboard-discoverable — the value is in the tab order and Enter opens the editor", async () => {
    const user = userEvent.setup();
    renderPlanner();

    const affordance = plannedCell("Groceries");
    affordance.focus();
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("textbox", { name: "Planned amount for Groceries" }),
    ).toBeInTheDocument();
    expect(affordance).toBeEnabled();

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("textbox", { name: "Planned amount for Groceries" }),
    ).not.toBeInTheDocument();
    expect(plannedCell("Groceries")).toBeEnabled();
  });

  it("keeps focus logical after save — back on the value's affordance", async () => {
    const user = userEvent.setup();
    renderPlanner();

    const input = await openPlannedEditor(user, "Groceries");
    await user.clear(input);
    await user.type(input, "150.00{Enter}");
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    const affordance = plannedCell("Groceries");
    expect(
      screen.queryByRole("textbox", { name: "Planned amount for Groceries" }),
    ).not.toBeInTheDocument();
    expect(affordance).toBeEnabled();
    expect(affordance).toHaveFocus();
  });

  it("keeps the draft and shows validation for invalid input, then accepts a correction", async () => {
    const user = userEvent.setup();
    renderPlanner();

    const input = await openPlannedEditor(user, "Groceries");
    await user.clear(input);
    await user.type(input, "abc{Enter}");

    // Invalid: the editor stays open, the draft is preserved, RTA never
    // jumps, and the validation message is announced.
    expect(input).toHaveValue("abc");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a valid dollar amount.",
    );
    expect(assignCategoryAction).not.toHaveBeenCalled();
    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent("$50.00");

    await user.clear(input);
    await user.type(input, "150.00{Enter}");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(assignCategoryAction).toHaveBeenCalledWith(
      monthId,
      "cat-groceries",
      "150.00",
    );
    expect(await screen.findByText("$30.00")).toBeInTheDocument();
  });

  it("surfaces a rejected assignment as validation and keeps the draft", async () => {
    const user = userEvent.setup();
    renderPlanner();

    assignCategoryAction.mockResolvedValueOnce({
      ok: false,
      error: "That amount would over-assign the month.",
    });

    const input = await openPlannedEditor(user, "Groceries");
    await user.clear(input);
    await user.type(input, "150.00{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That amount would over-assign the month.",
    );
    // Draft preserved for correction — nothing was committed, and the
    // editor keeps focus for an immediate retry.
    expect(input).toHaveValue("150.00");
    expect(input).toHaveFocus();
    expect(assignCategoryAction).toHaveBeenCalledTimes(1);
  });

  it("rests every affordance while a save is in flight, then confirms briefly", async () => {
    const user = userEvent.setup();
    renderPlanner();

    let resolveAction: (result: PlannerActionResult) => void = () => {};
    assignCategoryAction.mockImplementationOnce(
      () =>
        new Promise<PlannerActionResult>((resolve) => {
          resolveAction = resolve;
        }),
    );

    const input = await openPlannedEditor(user, "Groceries");
    await user.clear(input);
    await user.type(input, "150.00{Enter}");

    // In flight: the open editor and every other affordance rest.
    expect(input).toBeDisabled();
    expect(plannedCell("Dining Out")).toBeDisabled();

    resolveAction({ ok: true, error: null, availability });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(await screen.findByText("$30.00")).toBeInTheDocument();
    expect(plannedCell("Dining Out")).toBeEnabled();
    // The confirmation is brief — cleared just after its 1400ms beat.
    await waitFor(
      () => {
        expect(screen.queryByText("Saved")).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});

describe("PlannerView — Sika recommendation cards", () => {
  it("renders proposals as separate cards that mutate nothing until applied", () => {
    renderPlanner({ proposals });

    const card = screen.getByTestId("proposal-prop-1");
    expect(within(card).getByText("What Sika noticed")).toBeInTheDocument();
    expect(
      within(card).getByText("Back-to-school season"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/Suggests \$75\.00 to Dining Out/),
    ).toBeInTheDocument();
    // What changes if applied: 50.00 → 75.00 planned, RTA 50.00 → 25.00.
    expect(
      within(card).getByText(
        /Dining Out goes from \$50\.00 to \$75\.00 planned.*Ready to assign moves to \$25\.00/,
      ),
    ).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(
      within(card).getByRole("button", { name: "Not now" }),
    ).toBeEnabled();

    // The gate: nothing has been assigned, no action has run, the ledger is
    // untouched.
    expect(assignCategoryAction).not.toHaveBeenCalled();
    expect(applyProposalAction).not.toHaveBeenCalled();
    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent("$50.00");
  });

  it("applies a proposal through the action, adopts server truth, and collapses the card", async () => {
    const user = userEvent.setup();
    renderPlanner({ proposals });

    applyProposalAction.mockResolvedValueOnce({
      ok: true,
      error: null,
      availability: availability.map((a) =>
        a.categoryId === "cat-dining" ? { ...a, assignedCents: 7500 } : a,
      ),
    });

    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(applyProposalAction).toHaveBeenCalledWith(monthId, proposals[0]);
    // Server truth lands: 200.00 − 100.00 − 75.00 = 25.00.
    expect(await screen.findByText("$25.00")).toBeInTheDocument();
    expect(
      await screen.findByText(/Applied — \$75\.00 to Dining Out\./),
    ).toBeInTheDocument();
    // The Applied beat replaces the card, then the whole section collapses.
    await waitFor(
      () =>
        expect(
          screen.queryByTestId("recommendations"),
        ).not.toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("dismisses a proposal quietly without touching the ledger", async () => {
    const user = userEvent.setup();
    renderPlanner({ proposals });

    await user.click(screen.getByRole("button", { name: "Not now" }));

    expect(screen.queryByTestId("recommendations")).not.toBeInTheDocument();
    expect(applyProposalAction).not.toHaveBeenCalled();
    expect(screen.getByTestId("ready-to-assign")).toHaveTextContent("$50.00");
  });
});
