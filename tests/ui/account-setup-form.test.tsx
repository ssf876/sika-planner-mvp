import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountSetupForm } from "@/app/onboarding/accounts/account-setup-form";
import type { AccountFormState } from "@/app/actions/accounts";

const createAccountAction = vi.fn<
  (prev: AccountFormState, formData: FormData) => Promise<AccountFormState>
>(async () => ({
  error: null,
  ok: true,
}));

vi.mock("@/app/actions/accounts", () => ({
  createAccountAction: (...args: [AccountFormState, FormData]) =>
    createAccountAction(...args),
}));

beforeEach(() => {
  createAccountAction.mockClear();
  createAccountAction.mockResolvedValue({ error: null, ok: true });
});

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  fields: { kind: string; name: string; startingBalance?: string },
) {
  await user.click(screen.getByRole("radio", { name: fields.kind }));
  await user.type(screen.getByLabelText("Account name"), fields.name);
  if (fields.startingBalance) {
    await user.type(
      screen.getByLabelText("Starting balance"),
      fields.startingBalance,
    );
  }
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

describe("AccountSetupForm", () => {
  it("offers exactly the four first-run account kinds", () => {
    render(<AccountSetupForm />);

    const fieldset = screen.getByRole("group", {
      name: "What kind of account is it?",
    });
    const kinds = within(fieldset)
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("value"));
    expect(kinds).toEqual(["CHECKING", "SAVINGS", "CREDIT", "CASH"]);
  });

  it("submits the chosen type, name, and optional balance", async () => {
    const user = userEvent.setup();
    render(<AccountSetupForm />);

    await fillAndSubmit(user, {
      kind: "Checking",
      name: "Everyday Checking",
      startingBalance: "1,200",
    });

    expect(createAccountAction).toHaveBeenCalledTimes(1);
    const firstCall = createAccountAction.mock.calls[0];
    if (!firstCall) throw new Error("action was not called");
    const [, formData] = firstCall;
    expect(formData).toBeInstanceOf(FormData);
    expect(String(formData.get("kind"))).toBe("CHECKING");
    expect(String(formData.get("name"))).toBe("Everyday Checking");
    expect(String(formData.get("startingBalance"))).toBe("1,200");
  });

  it("sends an empty starting balance when left out", async () => {
    const user = userEvent.setup();
    render(<AccountSetupForm />);

    await fillAndSubmit(user, { kind: "Credit card", name: "Visa Card" });

    const firstCall = createAccountAction.mock.calls[0];
    if (!firstCall) throw new Error("action was not called");
    const [, formData] = firstCall;
    expect(String(formData.get("kind"))).toBe("CREDIT");
    expect(String(formData.get("startingBalance"))).toBe("");
  });

  it("confirms the creation and clears the form for the next account", async () => {
    const user = userEvent.setup();
    render(<AccountSetupForm />);

    await fillAndSubmit(user, {
      kind: "Checking",
      name: "Everyday Checking",
      startingBalance: "1,200",
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Created Everyday Checking.",
    );
    const list = screen.getByTestId("created-accounts");
    expect(list).toHaveTextContent("Everyday Checking · Checking");
    // The exit CTA only appears once an account exists.
    expect(
      screen.getByRole("link", { name: "Go to your dashboard" }),
    ).toHaveAttribute("href", "/dashboard");

    expect(
      (screen.getByLabelText("Account name") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByLabelText("Starting balance") as HTMLInputElement).value,
    ).toBe("");
  });

  it("accumulates every account added during setup", async () => {
    const user = userEvent.setup();
    render(<AccountSetupForm />);

    await fillAndSubmit(user, {
      kind: "Checking",
      name: "Everyday Checking",
      startingBalance: "1,200",
    });
    await screen.findByRole("status");
    await fillAndSubmit(user, { kind: "Cash wallet", name: "Cash Wallet" });
    await screen.findByRole("status");

    const list = screen.getByTestId("created-accounts");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(list).toHaveTextContent("Everyday Checking · Checking");
    expect(list).toHaveTextContent("Cash Wallet · Cash wallet");
    expect(createAccountAction).toHaveBeenCalledTimes(2);
  });

  it("surfaces a server-side rejection as an alert with no confirmation", async () => {
    createAccountAction.mockResolvedValue({
      error: "Enter a starting balance as a dollar amount, e.g. 1,250.",
      ok: false,
    });
    const user = userEvent.setup();
    render(<AccountSetupForm />);

    await fillAndSubmit(user, {
      kind: "Savings",
      name: "Rainy Day",
      startingBalance: "abc",
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a starting balance as a dollar amount, e.g. 1,250.",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("created-accounts")).not.toBeInTheDocument();
    // No account to show for it — the exit CTA stays hidden too.
    expect(
      screen.queryByRole("link", { name: "Go to your dashboard" }),
    ).not.toBeInTheDocument();
  });
});
