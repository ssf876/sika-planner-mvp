// Edge-safe: imported by middleware.ts, which runs in the Edge runtime and
// must not pull node:crypto or Prisma into its bundle. Session mechanics that
// need those live in lib/auth/session.ts.
export const SESSION_COOKIE = "sika_session";

// Unauthenticated hits on these prefixes bounce to /login (cookie-presence
// check only; full session validation happens in server components).
export const PROTECTED_PATH_PREFIXES = ["/dashboard", "/onboarding"] as const;

export const AUTH_PAGES = ["/login", "/signup"] as const;
