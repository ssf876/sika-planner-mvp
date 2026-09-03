import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransferForm } from "@/app/transactions/transfer-form";
import type { TransactionFormState } from "@/app/actions/transactions";

const recordTransferAction = vi.fn<(
  prev: TransactionFormState,
  formData: FormData,
) => Promise<TransactionFormState>>(async () => ({
  error: null,
  ok: true,
}));

vi.mock("@/app/actions/transactions", () => ({
  recordTransferAction: (
    ...args: [TransactionFormState, FormData]
  ) => recordTransferAction(...args),
}));

const accounts = [
  { id: "acc-1", name: "Everyday" },
  { id: "acc-2", name: "Wallet" },
  { id: "acc-3", name: "Card" },
];

beforeEach(() => {
  recordTransferAction.mockClear();
  recordTransferAction.mockResolvedValue({ error: null, ok: true });
});

describe("TransferForm", () => {
  it("submits the two accounts and the amount", async () => {
    const user = userEvent.setup();
    render(<TransferForm accounts={accounts} today="2026-09-03" />);

    await user.selectOptions(screen.getByLabelText("From"), "acc-1");
    await user.selectOptions(screen.getByLabelText("To"), "acc-2");
    await user.type(screen.getByLabelText(/^Amount/), "40.00");
    await user.click(screen.getByRole("button", { name: "Record transfer" }));

    expect(recordTransferAction).toHaveBeenCalledTimes(1);
    const firstCall = recordTransferAction.mock.calls[0];
    if (!firstCall) throw new Error("action was not called");
    const [, formData] = firstCall;
    expect(String(formData.get("fromAccountId"))).toBe("acc-1");
    expect(String(formData.get("toAccountId"))).toBe("acc-2");
    expect(String(formData.get("amount"))).toBe("40.00");

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Transfer recorded.",
    );
  });

  it("surfaces a rejection (same-account move) as an alert", async () => {
    recordTransferAction.mockResolvedValue({
      error: "Pick two different accounts.",
      ok: false,
    });
    const user = userEvent.setup();
    render(<TransferForm accounts={accounts} today="2026-09-03" />);

    await user.selectOptions(screen.getByLabelText("From"), "acc-1");
    await user.selectOptions(screen.getByLabelText("To"), "acc-1");
    await user.type(screen.getByLabelText(/^Amount/), "40.00");
    await user.click(screen.getByRole("button", { name: "Record transfer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Pick two different accounts.",
    );
  });
});
