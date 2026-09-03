import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "./Card";

const meta = {
  title: "UI/Card",
  component: Card,
  tags: ["autodocs"],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  render: () => (
    <Card style={{ maxWidth: 320 }}>
      <Card.Body>Ready to assign: $0.00</Card.Body>
    </Card>
  ),
};

export const WithHeader: Story = {
  render: () => (
    <Card style={{ maxWidth: 320 }}>
      <Card.Header>
        <Card.Title>September 2026</Card.Title>
      </Card.Header>
      <Card.Body>Budget overview content.</Card.Body>
    </Card>
  ),
};

export const WatchTint: Story = {
  render: () => (
    <Card tone="watch" style={{ maxWidth: 320 }}>
      <Card.Header>
        <Card.Title>Groceries</Card.Title>
        <span style={{ fontSize: 13 }}>75% used</span>
      </Card.Header>
      <Card.Body>$4,125.00 of $5,500.00 spent.</Card.Body>
    </Card>
  ),
};

export const OverspentTint: Story = {
  render: () => (
    <Card tone="overspent" style={{ maxWidth: 320 }}>
      <Card.Header>
        <Card.Title>Dining out</Card.Title>
        <span style={{ fontSize: 13 }}>Over by $45.00</span>
      </Card.Header>
      <Card.Body>$245.00 of $200.00 spent.</Card.Body>
    </Card>
  ),
};
