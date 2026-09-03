import { NextResponse, type NextRequest } from "next/server";

import {
  AUTH_PAGES,
  PROTECTED_PATH_PREFIXES,
  SESSION_COOKIE,
} from "@/lib/auth/constants";

/**
 * Coarse edge-side route protection: presence of the session cookie only. The
 * Edge runtime can't run Prisma, so real session validation happens in server
 * components via requireUser()/requireOnboardedUser() — this middleware just
 * avoids round-tripping obviously unauthenticated traffic through the app.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

  const isProtected = PROTECTED_PATH_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
  const isAuthPage = (AUTH_PAGES as readonly string[]).includes(pathname);

  if (isProtected && !hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPage && hasSessionCookie) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding/:path*", "/login", "/signup"],
};
