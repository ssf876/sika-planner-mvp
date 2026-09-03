import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DangerTone } from "@/components/ui/types";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatCents } from "@/lib/money";

describe("ProgressBar", () => {
  it("exposes progressbar semantics with cents-based values", () => {
    render(<ProgressBar label="Housing" value={160000} max={550000} />);
    const bar = screen.getByRole("progressbar", { name: "Housing" });
    expect(bar).toHaveAttribute("aria-valuenow", "160000");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "550000");
    expect(bar).toHaveAttribute(
      "aria-valuetext",
      `${formatCents(160000)} of ${formatCents(550000)}`,
    );
  });

  it("shows the formatted '$X of $Y' amounts", () => {
    render(<ProgressBar label="Housing" value={160000} max={550000} />);
    expect(
      screen.getByText(`${formatCents(160000)} of ${formatCents(550000)}`),
    ).toBeInTheDocument();
  });

  it("hides the amounts row on request", () => {
    render(
      <ProgressBar label="Housing" value={160000} max={550000} hideAmounts />,
    );
    expect(
      screen.queryByText(`${formatCents(160000)} of ${formatCents(550000)}`),
    ).not.toBeInTheDocument();
  });

  it.each([
    { value: 160000, tone: "healthy" },
    { value: 420000, tone: "watch" },
    { value: 560000, tone: "overspent" },
  ] satisfies Array<{ value: number; tone: DangerTone }>)(
    "derives the danger tone from spend ($value of 550000 → $tone)",
    ({ value, tone }) => {
      const { container } = render(
        <ProgressBar label="Housing" value={value} max={550000} />,
      );
      expect(container.firstElementChild).toHaveClass(tone);
    },
  );

  it("honors an explicit tone override", () => {
    const { container } = render(
      <ProgressBar label="Goal" value={10000} max={550000} tone="watch" />,
    );
    expect(container.firstElementChild).toHaveClass("watch");
  });
});
