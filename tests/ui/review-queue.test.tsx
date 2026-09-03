import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewQueue } from "@/app/transactions/review-queue";
import type { ReviewQueueFormState } from "@/app/actions/categorizer-state";
import type { ReviewQueueRow } from "@/lib/repositories/categorizer";

const confirmReviewAction = vi.fn<
  (
    prev: ReviewQueueFormState,
    formData: FormData,
  ) => Promise<ReviewQueueFormState>
>(async () => ({
  error: null,
  ok: true,
}));

const setAutoAccept = vi.fn<(formData: FormData) => Promise<void>>(
  async () => {},
);

vi.mock("@/app/actions/categorizer", () => ({
  confirmReviewAction: (...args: [ReviewQueueFormState, FormData]) =>
    confirmReviewAction(...args),
  setAutoAcceptAction: (formData: FormData) => setAutoAccept(formData),
}));

const categories = [
  { id: "cat-groceries", name: "Groceries", group: "NEEDS" as const },
  { id: "cat-dining", name: "Dining Out", group: "WANTS" as const },
];

function row(overrides: Partial<ReviewQueueRow>): ReviewQueueRow {
  return {
    id: "tx-1",
    accountName: "Everyday",
    kind: "EXPENSE",
    amountCents: -5000,
    date: "2026-09-05",
    payee: "Whole Foods Market",
    pending: false,
    note: null,
    suggestion: null,
    ...overrides,
  };
}

beforeEach(() => {
  confirmReviewAction.mockClear();
  confirmReviewAction.mockResolvedValue({ error: null, ok: true });
  setAutoAccept.mockClear();
});

function renderQueue(
  rows: ReviewQueueRow[],
  autoAccept = false,
): ReturnType<typeof render> {
  return render(
    <ReviewQueue rows={rows} categories={categories} autoAccept={autoAccept} />,
  );
}

/** The FormData the confirm action would receive for one row's form. */
async function submitRowForm(
  user: ReturnType<typeof userEvent.setup>,
  confirmLabel: RegExp,
): Promise<FormData> {
  const buttons = screen.getAllByRole("button", { name: confirmLabel });
  await user.click(buttons[0]);
  expect(confirmReviewAction).toHaveBeenCalledTimes(1);
  const formData = confirmReviewAction.mock.calls[0][1];
  expect(formData.get("transactionId")).toBeTruthy();
  return formData;
}

describe("ReviewQueue", () => {
  it("renders the empty state when there is nothing to review", () => {
    renderQueue([]);

    expect(screen.getByRole("status")).toHaveTextContent(/Nothing to review/i);
  });

  it("pre-fills the learned suggestion and shows its confidence", () => {
    renderQueue([
      row({
        suggestion: { categoryId: "cat-groceries", confidence: 1 },
      }),
    ]);

    const select = screen.getByLabelText(/Category for Whole Foods Market/i);
    expect(select).toHaveValue("cat-groceries");
    // Exact matches are labeled, not just percentages.
    expect(screen.getByText("Exact match")).toBeInTheDocument();
  });

  it("one-click confirm submits the suggested category untouched", async () => {
    const user = userEvent.setup();
    renderQueue([
      row({
        suggestion: { categoryId: "cat-groceries", confidence: 1 },
      }),
    ]);

    const formData = await submitRowForm(user, /^confirm$/i);
    expect(formData.get("categoryId")).toBe("cat-groceries");
  });

  it("edit-then-confirm submits the overridden category instead", async () => {
    const user = userEvent.setup();
    renderQueue([
      row({
        suggestion: { categoryId: "cat-groceries", confidence: 1 },
      }),
    ]);

    await user.selectOptions(
      screen.getByLabelText(/Category for Whole Foods Market/i),
      "cat-dining",
    );
    const formData = await submitRowForm(user, /^confirm$/i);
    expect(formData.get("categoryId")).toBe("cat-dining");
  });

  it("shows a keyword match as a percentage with no pre-fill beyond the suggestion", () => {
    renderQueue([
      row({
        payee: "Shell Gas Station",
        suggestion: { categoryId: "cat-groceries", confidence: 0.5 },
      }),
    ]);

    const select = screen.getByLabelText(/Category for Shell Gas Station/i);
    expect(select).toHaveValue("cat-groceries");
    expect(screen.getByText("50% match")).toBeInTheDocument();
  });

  it("income rows confirm as Ready to Assign with no category select", async () => {
    const user = userEvent.setup();
    renderQueue([
      row({ kind: "INCOME", amountCents: 300000, payee: "Employer" }),
    ]);

    expect(
      screen.queryByLabelText(/Category for Employer/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Ready to Assign")).toBeInTheDocument();

    const formData = await submitRowForm(user, /^confirm$/i);
    expect(formData.get("categoryId")).toBeNull();
  });

  it("marks rows with no suggestion and requires a category before confirming", () => {
    renderQueue([row({})]);

    expect(screen.getByText("No suggestion")).toBeInTheDocument();
    const select = screen.getByLabelText(/Category for Whole Foods Market/i);
    expect(select).toBeRequired();
  });

  it("surfaces server-side rejections as an alert", async () => {
    confirmReviewAction.mockResolvedValue({
      error: "That row was already reviewed.",
      ok: false,
    });
    const user = userEvent.setup();
    renderQueue([row({})]);

    // The client requires a category first; the server can still reject
    // (e.g. the row was confirmed from another tab in the meantime).
    await user.selectOptions(
      screen.getByLabelText(/Category for Whole Foods Market/i),
      "cat-groceries",
    );
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /already reviewed/i,
    );
  });

  it("toggles the per-household auto-accept setting through the action", async () => {
    const user = userEvent.setup();
    renderQueue([], true);

    const checkbox = screen.getByRole("checkbox", {
      name: /auto-accept high-confidence/i,
    });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(setAutoAccept).toHaveBeenCalledTimes(1);
    const formData = setAutoAccept.mock.calls[0][0];
    // Unchecking submits the form without the "on" value.
    expect(formData.get("autoAccept")).toBeNull();
  });

  it("keeps pending rows visible next to the payee", () => {
    renderQueue([row({ pending: true })]);
    expect(
      screen.getByText(/Whole Foods Market \(pending\)/),
    ).toBeInTheDocument();
  });

  it("renders every queue row with its own confirm control", () => {
    renderQueue([
      row({ payee: "Whole Foods Market" }),
      row({ id: "tx-2", payee: "Shell" }),
    ]);

    const table = screen.getByRole("table");
    expect(
      within(table).getAllByRole("button", { name: /^confirm$/i }),
    ).toHaveLength(2);
  });
});
