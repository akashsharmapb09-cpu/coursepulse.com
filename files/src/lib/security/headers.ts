/**
 * Static security headers and route-privacy rules (security.md §11). Pure functions, edge/node safe.
 */

/** Applied to every response. */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<
  readonly [name: string, value: string]
> = [
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  [
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  ],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  ["X-Frame-Options", "DENY"], // legacy twin of CSP frame-ancestors 'none'
];

/** Production only, and only after HTTPS is verified end-to-end. 'preload' is deliberately NOT included. */
export const HSTS_HEADER = [
  "Strict-Transport-Security",
  "max-age=63072000; includeSubDomains",
] as const;

/** Areas that must never be indexed or cached: role areas, the API, and authentication pages. */
const PRIVATE_PREFIXES = [
  "/student",
  "/instructor",
  "/admin",
  "/api",
  "/login",
  "/activate",
  "/forgot-password",
  "/reset-password",
] as const;

/** Pages whose URL may carry a single-use token: never leak it through the Referer header. */
const TOKEN_PREFIXES = ["/activate", "/reset-password", "/consent"] as const;

function normalizePath(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, "/").toLowerCase();
  return collapsed.length > 1 && collapsed.endsWith("/")
    ? collapsed.slice(0, -1)
    : collapsed;
}

function matchesPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function isPrivatePath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return (
    matchesPrefix(path, PRIVATE_PREFIXES) || matchesPrefix(path, TOKEN_PREFIXES)
  );
}

/** Extra headers for private routes (empty object for public routes). */
export function privateRouteHeaders(pathname: string): Record<string, string> {
  if (!isPrivatePath(pathname)) return {};
  const headers: Record<string, string> = {
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "no-store",
  };
  if (matchesPrefix(normalizePath(pathname), TOKEN_PREFIXES))
    headers["Referrer-Policy"] = "no-referrer";
  return headers;
}
