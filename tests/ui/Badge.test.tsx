import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "@/components/ui/Badge";

describe("Badge", () => {
  it.each(["healthy", "watch", "overspent", "neutral", "info"] as const)(
    "renders the %s tone",
    (tone) => {
      render(<Badge tone={tone}>Label</Badge>);
      expect(screen.getByText("Label")).toHaveClass(tone);
    },
  );

  it("defaults to the neutral tone", () => {
    render(<Badge>April</Badge>);
    expect(screen.getByText("April")).toHaveClass("neutral");
  });
});
