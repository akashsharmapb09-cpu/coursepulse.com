/**
 * Content-Security-Policy builder (nonce + 'strict-dynamic'). Edge/node safe: Web Crypto only.
 * Trade-offs are documented in security.md §11 (style-src 'unsafe-inline') and risk R-11 (nonce vs static rendering).
 */

export interface CspOptions {
  /** Per-request nonce from generateNonce(). */
  nonce: string;
  /** Development adds eval and websocket sources needed by the dev server. Never true in production. */
  isDev: boolean;
  /** Analytics host (only when consent-gated analytics is configured). Must be https. */
  analyticsOrigin?: string | undefined;
  /** Allow the Cloudflare Turnstile widget (only on pages that render it). */
  turnstile?: boolean;
}

const NONCE_PATTERN = /^[A-Za-z0-9+/]{22,}={0,2}$/;
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** 128-bit random nonce, base64. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function httpsOrigin(value: string, label: string): string {
  const url = new URL(value); // throws on invalid input
  if (url.protocol !== "https:")
    throw new Error(`${label} must be an https origin`);
  return url.origin;
}

export function buildCsp(options: CspOptions): string {
  // The nonce and origins are interpolated into a response header: reject anything that could inject directives.
  if (!NONCE_PATTERN.test(options.nonce)) throw new Error("invalid CSP nonce");
  const analytics = options.analyticsOrigin
    ? httpsOrigin(options.analyticsOrigin, "analyticsOrigin")
    : undefined;

  const scriptSrc = ["'self'", `'nonce-${options.nonce}'`, "'strict-dynamic'"];
  if (options.turnstile) scriptSrc.push(TURNSTILE_ORIGIN);
  if (options.isDev) scriptSrc.push("'unsafe-eval'");

  const connectSrc = ["'self'"];
  if (analytics) connectSrc.push(analytics);
  if (options.isDev) connectSrc.push("ws:", "wss:");

  const directives: string[] = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'", // style-only relaxation (Tailwind/Next/Framer inline styles); see security.md §11
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${options.turnstile ? TURNSTILE_ORIGIN : "'none'"}`,
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  if (!options.isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
