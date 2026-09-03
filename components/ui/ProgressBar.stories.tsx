import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProgressBar } from "./ProgressBar";

const meta = {
  title: "UI/ProgressBar",
  component: ProgressBar,
  tags: ["autodocs"],
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = {
  args: { label: "Housing", value: 160000, max: 550000 },
};
export const Watch: Story = {
  args: { label: "Groceries", value: 412500, max: 550000 },
};
export const Overspent: Story = {
  args: { label: "Dining out", value: 24500, max: 20000 },
};
export const HiddenAmounts: Story = {
  args: { label: "Savings", value: 90000, max: 600000, hideAmounts: true },
};
