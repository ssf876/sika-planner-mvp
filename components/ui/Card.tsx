import type { ComponentPropsWithoutRef } from "react";
import styles from "./Card.module.css";
import type { DangerTone } from "./types";

export type CardTone = "neutral" | DangerTone;

export interface CardProps extends ComponentPropsWithoutRef<"div"> {
  /** Danger-vocabulary tint for budget-facing surfaces (danger strip). */
  tone?: CardTone;
}

function toneClass(tone: CardTone): string {
  return tone === "neutral" ? "" : ` ${styles[tone]}`;
}

export function CardRoot({
  tone = "neutral",
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={`${styles.card}${toneClass(tone)}${
        className ? ` ${className}` : ""
      }`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={`${styles.header}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"h3">) {
  return (
    <h3
      className={`${styles.title}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </h3>
  );
}

export function CardBody({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={`${styles.body}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={`${styles.footer}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * Compound card: usable as a plain surface (<Card>…</Card>) or with its
 * named parts (<Card.Header><Card.Title>…) for the dashboard grammar.
 */
export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Body: CardBody,
  Footer: CardFooter,
});
