import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FundsBoard } from "@/app/funds/funds-board";
import type { FundFormState } from "@/app/actions/funds";
import type { FundBoardEntry, FundBoard } from "@/lib/repositories/funds";

const mockAction = vi.fn<
  (prev: FundFormState, formData: FormData) => Promise<FundFormState>
>(async () => ({ error: null, ok: true }));

vi.mock("@/app/actions/funds", () => ({
  createFundAction: (prev: FundFormState, formData: FormData) =>
    mockAction(prev, formData),
  contributeFundAction: (prev: FundFormState, formData: FormData) =>
    mockAction(prev, formData),
  recordFundDrawAction: (prev: FundFormState, formData: FormData) =>
    mockAction(prev, formData),
  recordStaticDrawAction: (prev: FundFormState, formData: FormData) =>
    mockAction(prev, formData),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const accounts = [
  { id: "acc-checking", name: "Everyday" },
  { id: "acc-wallet", name: "Wallet" },
];

const categories = [
  { id: "cat-groceries", name: "Groceries" },
  { id: "cat-buffer", name: "Car repairs" },
];

function fundEntry(overrides: Partial<FundBoardEntry>): FundBoardEntry {
  return {
    id: "fund-1",
    kind: "SINKING",
    name: "Car repairs",
    balanceCents: 26000,
    targetCents: 100000,
    targetDate: undefined,
    companionCategory: { id: "cat-buffer", name: "Car repairs" },
    draws: [],
    ...overrides,
  };
}

function boardView(funds: FundBoardEntry[]): FundBoard {
  return {
    funds,
    month: {
      monthId: "m1",
      label: "September 2026",
      incomeReceivedCents: 100000,
      fundDrawCents: 24000,
      spendingCents: 1000,
      netCashflowCents: 123000,
    },
  };
}

beforeEach(() => {
  mockAction.mockClear();
  mockAction.mockResolvedValue({ error: null, ok: true });
});

describe("FundsBoard — board rendering", () => {
  it("shows the month strip and a fund's balance, target, and companion", () => {
    render(
      <FundsBoard
        {...boardView([fundEntry({})])}
        accounts={accounts}
        categories={categories}
        today="2026-09-03"
      />,
    );

    expect(screen.getByText("September 2026 cashflow")).toBeInTheDocument();
    expect(screen.getByText("Income received")).toBeInTheDocument();
    expect(screen.getByText("Popped up")).toBeInTheDocument();
    expect(screen.getByText("$260.00 toward $1,000.00")).toBeInTheDocument();
    expect(
      screen.getByText("Pays pop-ups against “Car repairs”."),
    ).toBeInTheDocument();
  });

  it("shows an empty state when the household has no funds", () => {
    render(
      <FundsBoard
        {...boardView([])}
        accounts={accounts}
        categories={categories}
        today="2026-09-03"
      />,
    );

    expect(screen.getByText("No funds yet")).toBeInTheDocument();
  });

  it("renders zero cashflow when no month covers today", () => {
    render(
      <FundsBoard
        {...boardView([])}
        month={{
          monthId: null,
          label: "September 2026",
          incomeReceivedCents: 0,
          fundDrawCents: 0,
          spendingCents: 0,
          netCashflowCents: 0,
        }}
        accounts={accounts}
        categories={categories}
        today="2026-09-03"
      />,
    );

    expect(screen.getByText("September 2026 cashflow")).toBeInTheDocument();
    expect(screen.getAllByText("$0.00")).toHaveLength(4);
  });
});

describe("FundsBoard — draw history (popped up reporting)", () => {
  it("labels pop-up draws with the month, amount, and payee", () => {
    render(
      <FundsBoard
        {...boardView([
          fundEntry({
            draws: [
              {
                id: "draw-1",
                monthLabel: "September 2026",
                amountCents: 24000,
                paidExpense: true,
                expensePayee: "Midwest Movers",
              },
            ],
          }),
        ])}
        accounts={accounts}
        categories={categories}
        today="2026-09-03"
      />,
    );

    const item = screen.getByText(/Popped up \$240\.00/).closest("li");
    expect(item).toHaveTextContent(
      "September 2026 · paid Midwest Movers",
    );
  });

  it("marks draws with no linked expense as goal draws", () => {
    render(
      <FundsBoard
        {...boardView([
          fundEntry({
            kind: "STATIC",
            name: "Emergency fund",
            companionCategory: null,
            draws: [
              {
                id: "draw-2",
                monthLabel: "September 2026",
                amountCents: 50000,
                paidExpense: false,
                expensePayee: undefined,
              },
            ],
          }),
        ])}
        accounts={accounts}
        categories={categories}
        today="2026-09-03"
      />,
    );

    const item = screen.getByText(/Popped up \$500\.00/).closest("li");
    expect(item).toHaveTextContent("September 2026 · goal draw");
  });
});

describe("FundsBoard — create fund", () => {
  it("submits kind, name, target, and optional companion category", async () => {
    const user = userEvent.setup();
    render(
      <FundsBoard
        {...boardView([])}
        accounts={accounts}
        categories={categories}
        today="2026-09-03"
      />,
    );

    // Sinking is the default kind; assert the radio state and submit it.
    const sinking = screen.getByRole("radio", { name: /Sinking fund/ });
    expect(sinking).toBeChecked();
    await user.type(screen.getByLabelText(/^Fund name/), "Holidays");
    await user.type(screen.getByLabelText("Target amount (optional)"), "1200");
    await user.selectOptions(
      screen.getByLabelText("Backed by category (optional)"),
      "cat-groceries",
    );
    await user.click(screen.getByRole("button", { name: "Create fund" }));

    expect(mockAction).toHaveBeenCalledTimes(1);
    const firstCall = mockAction.mock.calls[0];
    if (!firstCall) throw new Error("action was not called");
    const [, formData] = firstCall;
    expect(String(formData.get("kind"))).toBe("SINKING");
    expect(String(formData.get("name"))).toBe("Holidays");
    expect(String(formData.get("targetAmount"))).toBe("1200");
    expect(String(formData.get("companionCategoryId"))).toBe("cat-groceries");
  });

  it("surfaces a rejection as an alert", async () => {
    mockAction.mockResolvedValue({
      error: "That category already backs another fund.",
      ok: false,
    });
    const user = userEvent.setup();
    render(
      <FundsBoard
        {...boardView([])}
        accounts={accounts}
        categories={categories}
        today="2026-09-03"
      />,
    );

    await user.type(screen.getByLabelText(/^Fund name/), "Dup");
    await user.click(screen.getByRole("button", { name: "Create fund" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That category already backs another fund.",
    );
  });
});

describe("FundsBoard — contribute", () => {
  it("submits the fund id and amount", async () => {
    const user = userEvent.setup();
    render(
      <FundsBoard
        {...boardView([fundEntry({})])}
        accounts={accounts}
        categories={categories}
        today="2026-09-03"
      />,
    );

    await user.type(screen.getByLabelText(/^Contribution/), "75.00");
    await user.click(screen.getByRole("button", { name: "Add contribution" }));

    expect(mockAction).toHaveBeenCalledTimes(1);
    const firstCall = mockAction.mock.calls[0];
    if (!firstCall) throw new Error("action was not called");
    const [, formData] = firstCall;
    expect(String(formData.get("fundId"))).toBe("fund-1");
    expect(String(formData.get("amount"))).toBe("75.00");
  });
});

describe("FundsBoard — pop-up draw (sinking)", () => {
  it("submits fund, account, amount, payee, and date", async () => {
    const user = userEvent.setup();
    render(
      <FundsBoard
        {...boardView([fundEntry({})])}
        accounts={accounts}
        categories={categories}
        today="2026-09-03"
      />,
    );

    await user.selectOptions(screen.getByLabelText("Paid from"), "acc-checking");
    await user.type(screen.getByLabelText(/^Pop-up cost/), "240.00");
    await user.type(screen.getByLabelText(/^Paid to/), "Midwest Movers");
    await user.click(screen.getByRole("button", { name: "Record pop-up" }));

    expect(mockAction).toHaveBeenCalledTimes(1);
    const firstCall = mockAction.mock.calls[0];
    if (!firstCall) throw new Error("action was not called");
    const [, formData] = firstCall;
    expect(String(formData.get("fundId"))).toBe("fund-1");
    expect(String(formData.get("accountId"))).toBe("acc-checking");
    expect(String(formData.get("amount"))).toBe("240.00");
    expect(String(formData.get("payee"))).toBe("Midwest Movers");
    expect(String(formData.get("date"))).toBe("2026-09-03");
  });
});

describe("FundsBoard — explicit static draw", () => {
  it("submits fund, amount, and date with no payee or account field", async () => {
    const user = userEvent.setup();
    render(
      <FundsBoard
        {...boardView([
          fundEntry({
            id: "fund-2",
            kind: "STATIC",
            name: "Emergency fund",
            companionCategory: null,
          }),
        ])}
        accounts={accounts}
        categories={categories}
        today="2026-09-03"
      />,
    );

    // A static goal draw is uncoupled: no account to post from, no payee.
    expect(screen.queryByLabelText("Paid from")).toBeNull();
    expect(screen.queryByLabelText(/^Paid to/)).toBeNull();

    await user.type(screen.getByLabelText(/^Draw amount/), "500.00");
    await user.click(screen.getByRole("button", { name: "Draw from goal" }));

    expect(mockAction).toHaveBeenCalledTimes(1);
    const firstCall = mockAction.mock.calls[0];
    if (!firstCall) throw new Error("action was not called");
    const [, formData] = firstCall;
    expect(String(formData.get("fundId"))).toBe("fund-2");
    expect(String(formData.get("amount"))).toBe("500.00");
    expect(String(formData.get("date"))).toBe("2026-09-03");
    expect(formData.get("payee")).toBeNull();
    expect(formData.get("accountId")).toBeNull();
  });
});
