import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@/components/ui/Table";

function renderTable() {
  return render(
    <Table>
      <TableHeader>
        <TableRow>
          <TableHeaderCell>Category</TableHeaderCell>
          <TableHeaderCell>Spent</TableHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow state="watch">
          <TableCell>Housing</TableCell>
          <TableCell>$1,600</TableCell>
        </TableRow>
        <TableRow state="overspent">
          <TableCell>Dining out</TableCell>
          <TableCell>$245</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe("Table", () => {
  it("renders header and body cells semantically", () => {
    renderTable();
    expect(
      screen.getByRole("columnheader", { name: "Category" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Housing" })).toBeInTheDocument();
  });

  it("tints rows with the danger vocabulary", () => {
    const { container } = renderTable();
    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0]).toHaveClass("watch");
    expect(rows[1]).toHaveClass("overspent");
  });
});
