/**
 * Sika Planner UI primitives — the composition base for every feature
 * screen (spec D6–D8). Import from "@/components/ui".
 */
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "./Button";
export { Input, type InputProps } from "./Input";
export { Card, type CardProps, type CardTone } from "./Card";
export { ProgressBar, type ProgressBarProps } from "./ProgressBar";
export { Badge, type BadgeProps, type BadgeTone } from "./Badge";
export {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  type TableRowProps,
} from "./Table";
export { WATCH_THRESHOLD, classifySpendState } from "./danger-state";
export { dangerTones, type DangerTone } from "./types";
