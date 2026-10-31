/**
 * CSRF layer 2 (security.md §11): every state-changing request must come from an allowed origin.
 * CORS is NOT treated as CSRF protection; this runs for all non-GET API requests (architecture.md §3.1).
 */

export interface OriginCheckInput {
  method: string;
  origin: string | null;
  referer: string | null;
  secFetchSite: string | null;
  /** Normalized origins from normalizeAllowedOrigins(). */
  allowedOrigins: readonly string[];
}

export type OriginCheckResult =
  | { ok: true }
  | { ok: false; reason: "cross_site_fetch" | "origin_mismatch" | "missing_origin" };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Throws on an invalid entry so a bad configuration fails at boot, not at request time. */
export function normalizeAllowedOrigins(origins: readonly string[]): string[] {
  const normalized = origins.map((origin) => {
    const result = normalizeOrigin(origin);
    if (result === null) throw new Error("invalid trusted origin in configuration");
    return result;
  });
  return [...new Set(normalized)];
}

export function checkRequestOrigin(input: OriginCheckInput): OriginCheckResult {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };
  if (input.secFetchSite === "cross-site") return { ok: false, reason: "cross_site_fetch" };

  const claimed = input.origin ?? (input.referer ? normalizeOrigin(input.referer) : null);
  if (claimed !== null && claimed !== "null") {
    const normalized = normalizeOrigin(claimed);
    return normalized !== null && input.allowedOrigins.includes(normalized)
      ? { ok: true }
      : { ok: false, reason: "origin_mismatch" };
  }
  if (input.origin === "null") return { ok: false, reason: "origin_mismatch" };

  // No Origin and no usable Referer: accept only when the browser itself attests a same-origin fetch.
  return input.secFetchSite === "same-origin" ? { ok: true } : { ok: false, reason: "missing_origin" };
}
