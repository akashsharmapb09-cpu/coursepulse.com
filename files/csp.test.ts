import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "@/lib/security/csp";

const nonce = generateNonce();
const prod = buildCsp({ nonce, isDev: false });

describe("generateNonce", () => {
  it("has at least 128 bits and is unique per call", () => {
    expect(atob(nonce).length).toBeGreaterThanOrEqual(16);
    const set = new Set(Array.from({ length: 200 }, () => generateNonce()));
    expect(set.size).toBe(200);
  });
});

describe("buildCsp (production)", () => {
  it("is nonce based with strict-dynamic and carries the nonce", () => {
    expect(prod).toContain(`'nonce-${nonce}'`);
    expect(prod).toContain("'strict-dynamic'");
  });
  it("never allows eval, wildcards or http sources for scripts", () => {
    const script =
      prod.split("; ").find((d) => d.startsWith("script-src")) ?? "";
    expect(script).not.toContain("unsafe-eval");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toMatch(/(^|\s)\*(\s|$)/);
    expect(script).not.toContain("http:");
  });
  it("blocks framing, plugins, base-uri changes and cross-origin form posts", () => {
    for (const d of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-src 'none'",
    ]) {
      expect(prod).toContain(d);
    }
  });
  it("upgrades insecure requests in production only", () => {
    expect(prod).toContain("upgrade-insecure-requests");
    expect(buildCsp({ nonce, isDev: true })).not.toContain(
      "upgrade-insecure-requests",
    );
  });
  it("adds eval and websockets only in development", () => {
    expect(prod).not.toContain("ws:");
    const dev = buildCsp({ nonce, isDev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("ws:");
  });
});

describe("buildCsp (options)", () => {
  it("allows Turnstile only when requested", () => {
    expect(prod).not.toContain("challenges.cloudflare.com");
    const t = buildCsp({ nonce, isDev: false, turnstile: true });
    expect(t).toContain("frame-src https://challenges.cloudflare.com");
    expect(t).toContain("script-src 'self'");
  });
  it("adds only the analytics origin to connect-src and rejects non-https", () => {
    const a = buildCsp({
      nonce,
      isDev: false,
      analyticsOrigin: "https://stats.example.org/js/x.js",
    });
    expect(a).toContain("connect-src 'self' https://stats.example.org");
    expect(() =>
      buildCsp({
        nonce,
        isDev: false,
        analyticsOrigin: "http://stats.example.org",
      }),
    ).toThrow();
    expect(() =>
      buildCsp({ nonce, isDev: false, analyticsOrigin: "not a url" }),
    ).toThrow();
  });
  it("rejects nonces that could inject header directives", () => {
    for (const bad of [
      "",
      "short",
      "abc; script-src *",
      "AAAAAAAAAAAAAAAAAAAAAA\r\nX-Evil: 1",
      "AAAAAAAAAAAAAAAAAAAAAA'",
    ]) {
      expect(() => buildCsp({ nonce: bad, isDev: false })).toThrow();
    }
  });
});
