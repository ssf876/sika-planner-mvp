import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";

const meta = {
  title: "UI/Badge",
  component: Badge,
  tags: ["autodocs"],
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {
  args: { tone: "healthy", children: "Healthy" },
};
export const Watch: Story = { args: { tone: "watch", children: "Watch" } };
export const Overspent: Story = {
  args: { tone: "overspent", children: "Overspent" },
};
export const Info: Story = {
  args: { tone: "info", children: "Pending review" },
};
export const Neutral: Story = { args: { children: "Draft" } };
