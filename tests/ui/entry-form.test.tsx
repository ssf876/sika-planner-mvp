import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionEntryForm } from "@/app/transactions/entry-form";
import type { TransactionFormState } from "@/app/actions/transactions";

const recordTransactionAction = vi.fn<(
  prev: TransactionFormState,
  formData: FormData,
) => Promise<TransactionFormState>>(async () => ({
  error: null,
  ok: true,
}));

vi.mock("@/app/actions/transactions", () => ({
  recordTransactionAction: (
    ...args: [TransactionFormState, FormData]
  ) => recordTransactionAction(...args),
}));

const accounts = [
  { id: "acc-1", name: "Everyday" },
  { id: "acc-2", name: "Wallet" },
];

const categories = [
  { id: "cat-1", name: "Groceries", group: "NEEDS" as const },
  { id: "cat-2", name: "Dining Out", group: "WANTS" as const },
];

beforeEach(() => {
  recordTransactionAction.mockClear();
  recordTransactionAction.mockResolvedValue({ error: null, ok: true });
});

function renderForm() {
  return render(
    <TransactionEntryForm
      accounts={accounts}
      categories={categories}
      today="2026-09-03"
    />,
  );
}

async function fillExpense(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Account"), "acc-1");
  // The Input primitive appends a "*" required mark to label text.
  await user.type(screen.getByLabelText(/^Amount/), "24.50");
  await user.type(screen.getByLabelText(/^Payee/), "Corner Grocer");
  await user.selectOptions(screen.getByLabelText("Category"), "cat-1");
}

describe("TransactionEntryForm", () => {
  it("lists accounts and groups expense categories by budget group", () => {
    renderForm();

    const accountSelect = screen.getByLabelText(
      "Account",
    ) as HTMLSelectElement;
    const names = Array.from(accountSelect.options).map((o) => o.text);
    expect(names).toEqual(["Choose an account…", "Everyday", "Wallet"]);

    const categorySelect = screen.getByLabelText(
      "Category",
    ) as HTMLSelectElement;
    const groups = within(categorySelect)
      .getAllByRole("group")
      .map((group) => group.getAttribute("label"));
    expect(groups).toEqual(["Needs", "Wants"]);
  });

  it("hides the category select for income entries", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Income" }));
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Expense" }));
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
  });

  it("submits a confirmed expense with the entered values", async () => {
    const user = userEvent.setup();
    renderForm();

    await fillExpense(user);
    await user.click(
      screen.getByRole("button", { name: "Record transaction" }),
    );

    expect(recordTransactionAction).toHaveBeenCalledTimes(1);
    const firstCall = recordTransactionAction.mock.calls[0];
    if (!firstCall) throw new Error("action was not called");
    const [, formData] = firstCall;
    expect(formData).toBeInstanceOf(FormData);
    expect(String(formData.get("accountId"))).toBe("acc-1");
    expect(String(formData.get("kind"))).toBe("EXPENSE");
    expect(String(formData.get("amount"))).toBe("24.50");
    expect(String(formData.get("payee"))).toBe("Corner Grocer");
    expect(String(formData.get("categoryId"))).toBe("cat-1");
    expect(formData.get("needsReview")).toBeNull();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Transaction recorded.",
    );
  });

  it("flags the entry for the review queue when the box is ticked", async () => {
    const user = userEvent.setup();
    renderForm();

    await fillExpense(user);
    await user.click(screen.getByRole("checkbox", { name: /needs review/i }));
    await user.click(
      screen.getByRole("button", { name: "Record transaction" }),
    );

    const firstCall = recordTransactionAction.mock.calls[0];
    if (!firstCall) throw new Error("action was not called");
    const [, formData] = firstCall;
    expect(formData.get("needsReview")).toBe("on");
  });

  it("marks pending card spend that has not settled", async () => {
    const user = userEvent.setup();
    renderForm();

    await fillExpense(user);
    await user.click(screen.getByRole("checkbox", { name: /pending/i }));
    await user.click(
      screen.getByRole("button", { name: "Record transaction" }),
    );

    const firstCall = recordTransactionAction.mock.calls[0];
    if (!firstCall) throw new Error("action was not called");
    const [, formData] = firstCall;
    expect(formData.get("pending")).toBe("on");
  });

  it("clears the form after a successful save", async () => {
    const user = userEvent.setup();
    renderForm();

    await fillExpense(user);
    await user.click(
      screen.getByRole("button", { name: "Record transaction" }),
    );
    await screen.findByRole("status");

    expect(
      (screen.getByLabelText(/^Amount/) as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText(/^Payee/) as HTMLInputElement).value,
    ).toBe("");
  });

  it("surfaces a server-side rejection as an alert", async () => {
    recordTransactionAction.mockResolvedValue({
      error: "Enter an amount greater than zero.",
      ok: false,
    });
    const user = userEvent.setup();
    renderForm();

    await fillExpense(user);
    await user.click(
      screen.getByRole("button", { name: "Record transaction" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter an amount greater than zero.",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
