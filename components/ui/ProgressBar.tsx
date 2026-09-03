import type { ComponentPropsWithoutRef } from "react";
import { formatCents } from "../../lib/money";
import { classifySpendState } from "./danger-state";
import styles from "./ProgressBar.module.css";
import type { DangerTone } from "./types";

export interface ProgressBarProps extends ComponentPropsWithoutRef<"div"> {
  /** Row label, e.g. the category or section name ("Housing"). */
  label: string;
  /** Spent amount in integer cents (money is Int cents everywhere). */
  value: number;
  /** Budget total in integer cents. */
  max: number;
  /** Override the danger tone; defaults to classifySpendState(value, max). */
  tone?: DangerTone;
  /** Hide the "$X of $Y" amounts (label-only variant). */
  hideAmounts?: boolean;
}

/**
 * Determinate budget progress with the mock-up's "$X spent of $Y" grammar.
 * The fill carries the danger vocabulary; a screen reader gets the same
 * numbers via aria-valuetext.
 */
export function ProgressBar({
  label,
  value,
  max,
  tone,
  hideAmounts = false,
  className,
  ...rest
}: ProgressBarProps) {
  const resolvedTone = tone ?? classifySpendState(value, max);
  const pct =
    max > 0
      ? Math.min(100, Math.round((value / max) * 100))
      : value > 0
        ? 100
        : 0;
  const valueText = `${formatCents(value)} of ${formatCents(max)}`;

  return (
    <div
      className={`${styles.wrapper} ${styles[resolvedTone]}${
        className ? ` ${className}` : ""
      }`}
      {...rest}
    >
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        {hideAmounts ? null : (
          <span className={styles.amounts}>{valueText}</span>
        )}
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuetext={valueText}
      >
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
