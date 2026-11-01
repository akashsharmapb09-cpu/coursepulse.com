import { describe, expect, it } from "vitest";
import {
  HSTS_HEADER,
  STATIC_SECURITY_HEADERS,
  isPrivatePath,
  privateRouteHeaders,
} from "@/lib/security/headers";

describe("isPrivatePath", () => {
  it("marks role areas, the API and auth pages as private", () => {
    for (const p of [
      "/admin",
      "/admin/users",
      "/student/dashboard",
      "/instructor/analytics",
      "/api/v1/me",
      "/login",
      "/activate",
      "/forgot-password",
      "/reset-password",
      "/consent/guardian",
    ]) {
      expect(isPrivatePath(p)).toBe(true);
    }
  });
  it("is case-, slash- and trailing-slash-insensitive", () => {
    for (const p of ["/ADMIN", "//admin//users", "/Admin/", "/API/v1/health"])
      expect(isPrivatePath(p)).toBe(true);
  });
  it("keeps public pages indexable and respects path boundaries", () => {
    for (const p of [
      "/",
      "/about",
      "/features",
      "/contact",
      "/support",
      "/privacy",
      "/terms",
      "/refund-policy",
      "/administrators-guide",
      "/apiary",
    ]) {
      expect(isPrivatePath(p)).toBe(false);
    }
  });
});

describe("privateRouteHeaders", () => {
  it("is empty for public pages", () => {
    expect(privateRouteHeaders("/about")).toEqual({});
  });
  it("sets noindex and no-store for private pages", () => {
    const h = privateRouteHeaders("/admin/users");
    expect(h["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(h["Cache-Control"]).toBe("no-store");
    expect(h["Referrer-Policy"]).toBeUndefined();
  });
  it("suppresses the Referer on token pages", () => {
    expect(privateRouteHeaders("/activate")["Referrer-Policy"]).toBe(
      "no-referrer",
    );
    expect(privateRouteHeaders("/reset-password")["Referrer-Policy"]).toBe(
      "no-referrer",
    );
  });
});

describe("static headers", () => {
  const map = new Map(STATIC_SECURITY_HEADERS);
  it("includes the required baseline", () => {
    expect(map.get("X-Content-Type-Options")).toBe("nosniff");
    expect(map.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(map.get("Permissions-Policy")).toContain("camera=()");
    expect(map.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(map.get("X-Frame-Options")).toBe("DENY");
  });
  it("HSTS has a long max-age, includes subdomains and does not preload", () => {
    expect(HSTS_HEADER[1]).toMatch(/max-age=\d{8,}/);
    expect(HSTS_HEADER[1]).toContain("includeSubDomains");
    expect(HSTS_HEADER[1]).not.toContain("preload");
  });
});
