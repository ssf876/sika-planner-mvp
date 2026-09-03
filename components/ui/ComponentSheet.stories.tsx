import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { Input } from "./Input";
import { ProgressBar } from "./ProgressBar";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "./Table";

const meta: Meta = {
  title: "UI/ComponentSheet",
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj;

const section: React.CSSProperties = { display: "grid", gap: 12 };
const columns: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "flex-start",
};
const heading: React.CSSProperties = { fontSize: 16, margin: 0 };

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={section}>
      <h3 style={heading}>{label}</h3>
      {children}
    </div>
  );
}

/** One-page overview of the Sika Planner design tokens and base primitives. */
export const Default: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 32, maxWidth: 960 }}>
      <Row label="Danger vocabulary">
        <div style={columns}>
          <Badge tone="healthy">Healthy</Badge>
          <Badge tone="watch">Watch</Badge>
          <Badge tone="overspent">Overspent</Badge>
        </div>
      </Row>

      <Row label="Buttons">
        <div style={columns}>
          <Button>Assign $250.00</Button>
          <Button variant="secondary">Reconcile</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete category</Button>
          <Button size="sm">Assign $250.00</Button>
        </div>
      </Row>

      <Row label="Inputs">
        <div style={{ ...columns, alignItems: "flex-start" }}>
          <Input label="Monthly take-home pay" />
          <Input
            label="Category name"
            error="Enter an amount greater than zero."
          />
        </div>
      </Row>

      <Row label="Cards">
        <div style={columns}>
          <Card style={{ width: 280 }}>
            <Card.Header>
              <Card.Title>September 2026</Card.Title>
            </Card.Header>
            <Card.Body>Ready to assign: $0.00</Card.Body>
          </Card>
          <Card tone="watch" style={{ width: 280 }}>
            <Card.Header>
              <Card.Title>Groceries</Card.Title>
              <span style={{ fontSize: 13 }}>75% used</span>
            </Card.Header>
            <Card.Body>$4,125.00 of $5,500.00</Card.Body>
          </Card>
          <Card tone="overspent" style={{ width: 280 }}>
            <Card.Header>
              <Card.Title>Dining out</Card.Title>
              <span style={{ fontSize: 13 }}>Over by $45.00</span>
            </Card.Header>
            <Card.Body>$245.00 of $200.00</Card.Body>
          </Card>
        </div>
      </Row>

      <Row label="Progress bars">
        <div style={{ ...section, maxWidth: 420 }}>
          <ProgressBar label="Housing" value={160000} max={550000} />
          <ProgressBar label="Groceries" value={412500} max={550000} />
          <ProgressBar label="Dining out" value={24500} max={20000} />
        </div>
      </Row>

      <Row label="Table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Category</TableHeaderCell>
              <TableHeaderCell>Spent</TableHeaderCell>
              <TableHeaderCell>State</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Housing</TableCell>
              <TableCell>$1,600.00</TableCell>
              <TableCell>
                <Badge tone="healthy">Healthy</Badge>
              </TableCell>
            </TableRow>
            <TableRow state="watch">
              <TableCell>Groceries</TableCell>
              <TableCell>$4,125.00</TableCell>
              <TableCell>
                <Badge tone="watch">Watch</Badge>
              </TableCell>
            </TableRow>
            <TableRow state="overspent">
              <TableCell>Dining out</TableCell>
              <TableCell>$245.00</TableCell>
              <TableCell>
                <Badge tone="overspent">Overspent</Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Row>
    </div>
  ),
};
