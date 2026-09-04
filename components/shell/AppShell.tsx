import Link from "next/link";

import { BrandMark } from "@/components/brand/BrandMark";

import { ProfileMenu } from "./ProfileMenu";
import styles from "./AppShell.module.css";

/** The three primary destinations; everything else stays URL-reachable. */
export type ShellNavKey = "overview" | "plan" | "activity";

const NAV_ITEMS: ReadonlyArray<{
  key: ShellNavKey;
  href: string;
  label: string;
}> = [
  { key: "overview", href: "/dashboard", label: "Overview" },
  { key: "plan", href: "/planner", label: "Plan" },
  { key: "activity", href: "/transactions", label: "Activity" },
];

/**
 * The one shared quiet shell. Pages hand over their topbar in exchange for:
 * brand mark, Overview / Plan / Activity nav, and the profile menu with
 * Sign out tucked inside. `title` renders as the page's editorial heading;
 * `titleActions` is an optional slot beside it (e.g. month paging).
 */
export function AppShell({
  active,
  title,
  titleActions,
  email,
  children,
}: {
  active?: ShellNavKey;
  title: string;
  titleActions?: React.ReactNode;
  email?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link
            href="/dashboard"
            className={styles.brandLink}
            aria-label="Sika Planner home"
          >
            <BrandMark />
          </Link>
          <nav className={styles.nav} aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={`${styles.navLink} ${active === item.key ? styles.navLinkActive : ""}`}
                aria-current={active === item.key ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className={styles.profileArea}>
            <ProfileMenu email={email} />
          </div>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.pageHead}>
          <h1 className={styles.pageTitle}>{title}</h1>
          {titleActions ? (
            <div className={styles.titleActions}>{titleActions}</div>
          ) : null}
        </div>
        {children}
      </main>
    </div>
  );
}
