import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./Input";

const meta = {
  title: "UI/Input",
  component: Input,
  tags: ["autodocs"],
  args: { label: "Monthly take-home pay" },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithHint: Story = {
  args: { label: "Category name", hint: "e.g. Groceries" },
};
export const WithError: Story = {
  args: {
    label: "Monthly take-home pay",
    error: "Enter an amount greater than zero.",
    defaultValue: "-500",
  },
};
export const Required: Story = {
  args: {
    label: "Planned amount",
    required: true,
    defaultValue: "2500",
  },
};
export const Invalid: Story = {
  args: {
    label: "Monthly take-home pay",
    error: "Required.",
    value: "",
    "aria-invalid": true,
  },
};
