"use client";

import { useEffect, useId, useRef, useState } from "react";

import { signOutAction } from "@/app/actions/auth";

import styles from "./ProfileMenu.module.css";

function initialsOf(email: string): string {
  const [local] = email.split("@");
  const parts = local.split(/[.\-_+]/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "S";
}

/**
 * The profile/avatar menu. Sign out lives here — deliberately not a large
 * always-visible button. Escape or a click outside closes the menu and
 * returns focus to the avatar.
 */
export function ProfileMenu({ email }: { email?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  const initials = email ? initialsOf(email) : "S";

  return (
    <div ref={rootRef} className={styles.wrap}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.avatarButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Account menu"
        onClick={() => setOpen((value) => !value)}
      >
        {initials}
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label="Account" className={styles.menu}>
          {email ? <div className={styles.menuEmail}>{email}</div> : null}
          <form action={signOutAction} className={styles.signOutForm}>
            <button type="submit" role="menuitem" className={styles.signOutItem}>
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
