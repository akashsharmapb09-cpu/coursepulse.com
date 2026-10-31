import { describe, expect, it } from "vitest";
import { checkRequestOrigin, normalizeAllowedOrigins, normalizeOrigin } from "@/lib/security/origin-check";

const allowed = normalizeAllowedOrigins(["https://app.example.edu", "https://app.example.edu/"]);
const base = { method: "POST", origin: null, referer: null, secFetchSite: null, allowedOrigins: allowed };

describe("normalizeAllowedOrigins", () => {
  it("normalizes and de-duplicates", () => {
    expect(allowed).toEqual(["https://app.example.edu"]);
  });
  it("throws on invalid configuration", () => {
    expect(() => normalizeAllowedOrigins(["not a url"])).toThrow();
    expect(() => normalizeAllowedOrigins(["ftp://x.example.edu"])).toThrow();
  });
  it("normalizeOrigin strips paths and rejects odd schemes", () => {
    expect(normalizeOrigin("https://a.example.edu/x?y=1")).toBe("https://a.example.edu");
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
  });
});

describe("checkRequestOrigin", () => {
  it("never blocks safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(checkRequestOrigin({ ...base, method, origin: "https://evil.example" }).ok).toBe(true);
    }
  });
  it("accepts a same-origin POST by Origin", () => {
    expect(checkRequestOrigin({ ...base, origin: "https://app.example.edu", secFetchSite: "same-origin" }).ok).toBe(true);
  });
  it("rejects cross-site fetches regardless of Origin", () => {
    const r = checkRequestOrigin({ ...base, origin: "https://app.example.edu", secFetchSite: "cross-site" });
    expect(r).toEqual({ ok: false, reason: "cross_site_fetch" });
  });
  it("rejects foreign, lookalike, suffix and null origins", () => {
    for (const origin of ["https://evil.example", "https://app.example.edu.evil.example", "http://app.example.edu", "https://app.example.edu:8443", "null"]) {
      expect(checkRequestOrigin({ ...base, origin }).ok).toBe(false);
    }
  });
  it("falls back to Referer when Origin is absent", () => {
    expect(checkRequestOrigin({ ...base, referer: "https://app.example.edu/admin/users" }).ok).toBe(true);
    expect(checkRequestOrigin({ ...base, referer: "https://evil.example/x" }).ok).toBe(false);
  });
  it("without Origin/Referer, accepts only browser-attested same-origin", () => {
    expect(checkRequestOrigin({ ...base, secFetchSite: "same-origin" }).ok).toBe(true);
    expect(checkRequestOrigin({ ...base, secFetchSite: "same-site" })).toEqual({ ok: false, reason: "missing_origin" });
    expect(checkRequestOrigin(base)).toEqual({ ok: false, reason: "missing_origin" });
  });
  it("covers every state-changing method", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(checkRequestOrigin({ ...base, method, origin: "https://evil.example" }).ok).toBe(false);
    }
  });
});
