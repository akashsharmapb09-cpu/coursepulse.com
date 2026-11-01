import { normalizeAllowedOrigins } from "./origin-check";

/**
 * Which requests the global origin gate (src/proxy.ts) applies to: every state-changing request to /api/**.
 * /api/internal/** is exempt because it authenticates with a bearer secret (cron), not cookies, and has no Origin.
 */
export function requiresOriginCheck(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  const path = pathname.replace(/\/{2,}/g, "/").toLowerCase();
  if (path === "/api/internal" || path.startsWith("/api/internal/"))
    return false;
  return path === "/api" || path.startsWith("/api/");
}

/**
 * Trusted origins = SITE_URL + TRUSTED_ORIGINS. Fails CLOSED: in production a missing SITE_URL yields an empty list,
 * so every mutation is rejected rather than silently allowed. Throws on malformed entries.
 */
export function trustedOriginsFrom(
  siteUrl: string | undefined,
  extra: string | undefined,
  isProduction: boolean,
): string[] {
  const base =
    siteUrl && siteUrl.trim() !== ""
      ? siteUrl
      : isProduction
        ? ""
        : "http://localhost:3000";
  const entries = [base, ...(extra ?? "").split(",")]
    .map((e) => e.trim())
    .filter((e) => e !== "");
  return normalizeAllowedOrigins(entries);
}
