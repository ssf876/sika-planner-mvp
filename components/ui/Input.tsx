import { useId, type ComponentPropsWithRef } from "react";
import styles from "./Input.module.css";

export interface InputProps extends Omit<
  ComponentPropsWithRef<"input">,
  "id" | "size"
> {
  label: string;
  hint?: string;
  error?: string;
}

/**
 * Text input with an always-associated label plus optional hint and
 * error text wired for assistive tech (aria-invalid, aria-describedby,
 * role="alert" on the error).
 */
export function Input({
  label,
  hint,
  error,
  required = false,
  className,
  ...rest
}: InputProps) {
  const autoId = useId();
  const hintId = hint ? `${autoId}-hint` : undefined;
  const errorId = error ? `${autoId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={className ? `${styles.field} ${className}` : styles.field}>
      <label className={styles.label} htmlFor={autoId}>
        {label}
        {required ? (
          <span className={styles.requiredMark} aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>
      <input
        id={autoId}
        className={error ? `${styles.input} ${styles.invalid}` : styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        required={required}
        {...rest}
      />
      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
