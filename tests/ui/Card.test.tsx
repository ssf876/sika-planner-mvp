import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "@/components/ui/Card";

describe("Card", () => {
  it("renders header, body, and footer content", () => {
    render(
      <Card>
        <Card.Header>
          <Card.Title>Housing</Card.Title>
        </Card.Header>
        <Card.Body>$1,600 spent of $5,500</Card.Body>
        <Card.Footer>Due on the 1st</Card.Footer>
      </Card>,
    );
    expect(screen.getByText("Housing")).toBeInTheDocument();
    expect(screen.getByText("$1,600 spent of $5,500")).toBeInTheDocument();
    expect(screen.getByText("Due on the 1st")).toBeInTheDocument();
  });

  it("tints with the danger vocabulary", () => {
    const { container } = render(<Card tone="overspent">Debts</Card>);
    expect(container.firstElementChild).toHaveClass("overspent");
  });
});
