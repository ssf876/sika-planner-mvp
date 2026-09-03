import type { ComponentPropsWithoutRef } from "react";
import styles from "./Badge.module.css";
import type { DangerTone } from "./types";

export type BadgeTone = "neutral" | "info" | DangerTone;

export interface BadgeProps extends ComponentPropsWithoutRef<"span"> {
  tone?: BadgeTone;
}

/** Compact status chip — the danger vocabulary in words ("Watch",
 *  "Overspent") plus neutral/info for non-budget labels. */
export function Badge({
  tone = "neutral",
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={`${styles.badge} ${styles[tone]}${
        className ? ` ${className}` : ""
      }`}
      {...rest}
    >
      {children}
    </span>
  );
}
