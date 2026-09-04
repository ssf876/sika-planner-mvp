import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/shell/AppShell";

vi.mock("@/app/actions/auth", () => ({
  signOutAction: vi.fn(async () => {}),
}));

function renderShell() {
  return render(
    <AppShell active="overview" title="Overview" email="demo@sika.test">
      <p>Shell body</p>
    </AppShell>,
  );
}

describe("AppShell", () => {
  it("renders the brand mark", () => {
    renderShell();
    expect(screen.getByAltText("Sika").getAttribute("src")).toContain(
      "sika-wordmark.svg",
    );
  });

  it("renders exactly the three primary nav destinations", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(links).toEqual(["/dashboard", "/planner", "/transactions"]);
  });

  it("labels the primary nav Overview, Plan, Activity", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveTextContent("Overview");
    expect(nav).toHaveTextContent("Plan");
    expect(nav).toHaveTextContent("Activity");
  });

  it("keeps Funds and Reports out of the primary nav", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.textContent).not.toContain("Funds");
    expect(nav.textContent).not.toContain("Reports");
  });

  it("marks the active nav item with aria-current", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders no visible sign-out control outside the profile menu", () => {
    renderShell();
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });

  it("renders the page title as the single level-1 heading", () => {
    renderShell();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Overview");
  });

  it("renders body content inside the shell", () => {
    renderShell();
    expect(screen.getByText("Shell body")).toBeInTheDocument();
  });
});
