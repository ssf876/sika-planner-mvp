import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Input } from "@/components/ui/Input";

describe("Input", () => {
  it("associates the label with the field", () => {
    render(<Input label="Monthly income" />);
    expect(screen.getByLabelText("Monthly income")).toBeInTheDocument();
  });

  it("shows the hint text", () => {
    render(
      <Input label="Monthly income" hint="Take-home amount after taxes" />,
    );
    expect(
      screen.getByText("Take-home amount after taxes"),
    ).toBeInTheDocument();
  });

  it("flags errors for assistive tech", () => {
    render(
      <Input label="Monthly income" error="Enter a whole number of cents" />,
    );
    const input = screen.getByLabelText("Monthly income");
    expect(input).toBeInvalid();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a whole number of cents",
    );
    expect(input).toHaveAttribute(
      "aria-describedby",
      expect.stringMatching(/-error$/),
    );
  });

  it("accepts typed input", async () => {
    const user = userEvent.setup();
    render(<Input label="Monthly income" />);
    await user.type(screen.getByLabelText("Monthly income"), "5500");
    expect(screen.getByLabelText("Monthly income")).toHaveValue("5500");
  });
});
