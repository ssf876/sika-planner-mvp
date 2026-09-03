import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth/constants";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The cookie carries an opaque random token; the database stores only its
// SHA-256 hash, so a leaked database cannot be replayed as live sessions.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Create a session row and set the cookie. Call only from server actions/route handlers. */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: { id: hashToken(token), userId, expiresAt },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Resolve the signed-in user (with household) from the session cookie, or null. */
export const getSessionUser = cache(async () => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { include: { household: true } } },
  });

  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
});

/** Delete the session row (no-op when the cookie is absent/stale) and clear the cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { id: hashToken(token) } });
  }
  store.delete(SESSION_COOKIE);
}

/**
 * Route protection for server components. Full session validation (not just
 * cookie presence — middleware only checks presence at the edge).
 */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Protected pages that need a household: bounce half-onboarded users back. */
export async function requireOnboardedUser() {
  const user = await requireUser();
  if (!user.householdId) redirect("/onboarding");
  return user as typeof user & { householdId: string };
}
