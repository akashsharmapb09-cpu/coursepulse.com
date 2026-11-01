import { NextResponse, type NextRequest } from "next/server";
import { problemResponse } from "@/lib/http/problem";
import { buildCsp, generateNonce } from "@/lib/security/csp";
import { privateRouteHeaders } from "@/lib/security/headers";
import { checkRequestOrigin } from "@/lib/security/origin-check";
import {
  requiresOriginCheck,
  trustedOriginsFrom,
} from "@/lib/security/request-policy";

/**
 * Request proxy (Next.js 16 name for the former "middleware"; confirm the file convention against the pinned
 * version in the first install). Runs before every matched request and does only cheap, stateless work:
 *   1. global CSRF origin gate for state-changing /api requests (security.md Â§11),
 *   2. per-request CSP nonce for pages,
 *   3. noindex / no-store / no-referrer headers for private routes.
 * Authentication and authorization are NOT decided here (architecture.md Â§3.1: route() wrapper + services).
 * This file may read NODE_ENV, SITE_URL and TRUSTED_ORIGINS directly because it must stay dependency-light.
 */

const isProduction = process.env.NODE_ENV === "production";
const trustedOrigins = trustedOriginsFrom(
  process.env.SITE_URL,
  process.env.TRUSTED_ORIGINS,
  isProduction,
);

export function proxy(request: NextRequest): NextResponse | Response {
  const { pathname } = request.nextUrl;

  if (requiresOriginCheck(request.method, pathname)) {
    const result = checkRequestOrigin({
      method: request.method,
      origin: request.headers.get("origin"),
      referer: request.headers.get("referer"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      allowedOrigins: trustedOrigins,
    });
    if (!result.ok) {
      return problemResponse({
        status: 403,
        code: "origin_not_allowed",
        title: "Request origin not allowed",
      });
    }
  }

  const privateHeaders = privateRouteHeaders(pathname);

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const response = NextResponse.next();
    for (const [name, value] of Object.entries(privateHeaders))
      response.headers.set(name, value);
    return response;
  }

  const nonce = generateNonce();
  const csp = buildCsp({ nonce, isDev: !isProduction });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp); // Next.js reads the nonce from the request CSP
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  for (const [name, value] of Object.entries(privateHeaders))
    response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: [
    "/api/:path*",
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
