import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "./Table";

const meta = {
  title: "UI/Table",
  component: Table,
  tags: ["autodocs"],
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

// Sample rows use the approved mock-up's September figures.
function SeptemberRows() {
  return (
    <>
      <TableHeader>
        <TableRow>
          <TableHeaderCell>Category</TableHeaderCell>
          <TableHeaderCell>Spent</TableHeaderCell>
          <TableHeaderCell>Remaining</TableHeaderCell>
          <TableHeaderCell>State</TableHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Housing</TableCell>
          <TableCell>$1,600.00</TableCell>
          <TableCell>$3,900.00</TableCell>
          <TableCell>
            <Badge tone="healthy">Healthy</Badge>
          </TableCell>
        </TableRow>
        <TableRow state="watch">
          <TableCell>Groceries</TableCell>
          <TableCell>$4,125.00</TableCell>
          <TableCell>$1,375.00</TableCell>
          <TableCell>
            <Badge tone="watch">Watch</Badge>
          </TableCell>
        </TableRow>
        <TableRow state="overspent">
          <TableCell>Dining out</TableCell>
          <TableCell>$245.00</TableCell>
          <TableCell>-$45.00</TableCell>
          <TableCell>
            <Badge tone="overspent">Overspent</Badge>
          </TableCell>
        </TableRow>
      </TableBody>
    </>
  );
}

export const SeptemberCategories: Story = {
  name: "September categories",
  render: () => <Table>{SeptemberRows()}</Table>,
};
