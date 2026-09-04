import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signOutAction } from "@/app/actions/auth";
import { ProfileMenu } from "@/components/shell/ProfileMenu";

vi.mock("@/app/actions/auth", () => ({
  signOutAction: vi.fn(async () => {}),
}));

const signOutMock = vi.mocked(signOutAction);

beforeEach(() => {
  signOutMock.mockClear();
});

describe("ProfileMenu", () => {
  it("keeps the menu closed by default", () => {
    render(<ProfileMenu email="demo@sika.test" />);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });

  it("opens the account menu from the avatar", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu email="demo@sika.test" />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    const menu = screen.getByRole("menu", { name: "Account" });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows the account email inside the menu", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu email="demo@sika.test" />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByText("demo@sika.test")).toBeInTheDocument();
  });

  it("submits the sign-out server action from inside the menu", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu email="demo@sika.test" />);
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    const item = screen.getByRole("menuitem", { name: "Sign out" });
    // The menu item submits the form wired to the sign-out action.
    expect(item).toHaveAttribute("type", "submit");
    expect(item.closest("form")).not.toBeNull();
  });

  it("closes on Escape and returns focus to the avatar", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu email="demo@sika.test" />);
    const avatar = screen.getByRole("button", { name: "Account menu" });
    await user.click(avatar);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(avatar).toHaveFocus();
  });

  it("closes on a click outside the menu", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ProfileMenu email="demo@sika.test" />
        <p>elsewhere</p>
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByText("elsewhere"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("toggles closed when the avatar is clicked again", async () => {
    const user = userEvent.setup();
    render(<ProfileMenu email="demo@sika.test" />);
    const avatar = screen.getByRole("button", { name: "Account menu" });
    await user.click(avatar);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(avatar);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders initials derived from the email", () => {
    render(<ProfileMenu email="shanice.sinclair@example.com" />);
    expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent(
      "SS",
    );
  });
});
