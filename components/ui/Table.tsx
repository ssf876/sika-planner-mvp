import type { ComponentPropsWithoutRef } from "react";
import styles from "./Table.module.css";
import type { DangerTone } from "./types";

/** Semantic table shell — pair with the row/cell parts for the
 *  review queue and category tables (spec D6/D7). */
export function Table({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"table">) {
  return (
    <table
      className={`${styles.table}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </table>
  );
}

export function TableHeader({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"thead">) {
  return (
    <thead className={className} {...rest}>
      {children}
    </thead>
  );
}

export function TableBody({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"tbody">) {
  return (
    <tbody className={className} {...rest}>
      {children}
    </tbody>
  );
}

export interface TableRowProps extends ComponentPropsWithoutRef<"tr"> {
  /** Danger-vocabulary tint for budget-facing rows. */
  state?: "none" | DangerTone;
  selected?: boolean;
}

export function TableRow({
  state = "none",
  selected = false,
  className,
  children,
  ...rest
}: TableRowProps) {
  const stateClass = state === "none" ? "" : ` ${styles[state]}`;
  const selectedClass = selected ? ` ${styles.selected}` : "";
  return (
    <tr
      className={`${styles.row}${stateClass}${selectedClass}${
        className ? ` ${className}` : ""
      }`}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function TableHeaderCell({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"th">) {
  return (
    <th
      scope="col"
      className={`${styles.headerCell}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TableCell({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"td">) {
  return (
    <td
      className={`${styles.cell}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </td>
  );
}
