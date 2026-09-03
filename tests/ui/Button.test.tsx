import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";

describe("Button", () => {
  it("renders its label with a form-submit-safe default type", () => {
    render(<Button>Assign $250</Button>);
    const button = screen.getByRole("button", { name: "Assign $250" });
    expect(button).toHaveAttribute("type", "button");
  });

  it("applies the requested variant and size classes", () => {
    render(
      <Button variant="danger" size="sm">
        Delete
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveClass("danger");
    expect(button).toHaveClass("sm");
  });

  it("fires onClick and stops when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);

    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
