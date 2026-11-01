import { describe, expect, it } from "vitest";
import {
  requiresOriginCheck,
  trustedOriginsFrom,
} from "@/lib/security/request-policy";

describe("requiresOriginCheck", () => {
  it("gates every state-changing method on /api", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(requiresOriginCheck(method, "/api/v1/me")).toBe(true);
      expect(requiresOriginCheck(method, "/api/auth/sign-in/email")).toBe(true);
    }
  });
  it("does not gate safe methods or non-API pages", () => {
    expect(requiresOriginCheck("GET", "/api/v1/me")).toBe(false);
    expect(requiresOriginCheck("HEAD", "/api/v1/me")).toBe(false);
    expect(requiresOriginCheck("POST", "/admin/users")).toBe(false);
  });
  it("exempts only the bearer-secret internal route, and cannot be dodged by case or slashes", () => {
    expect(requiresOriginCheck("POST", "/api/internal/maintenance")).toBe(
      false,
    );
    expect(requiresOriginCheck("POST", "/API//INTERNAL/maintenance")).toBe(
      false,
    );
    expect(requiresOriginCheck("POST", "/api/internalx/run")).toBe(true);
    expect(requiresOriginCheck("POST", "//API/v1/me")).toBe(true);
  });
});

describe("trustedOriginsFrom", () => {
  it("combines SITE_URL and extra origins, normalized", () => {
    expect(
      trustedOriginsFrom(
        "https://app.example.edu/",
        " https://preview.example.edu , ",
        true,
      ),
    ).toEqual(["https://app.example.edu", "https://preview.example.edu"]);
  });
  it("defaults to localhost only outside production", () => {
    expect(trustedOriginsFrom(undefined, undefined, false)).toEqual([
      "http://localhost:3000",
    ]);
  });
  it("fails closed in production when SITE_URL is missing", () => {
    expect(trustedOriginsFrom(undefined, undefined, true)).toEqual([]);
    expect(trustedOriginsFrom("  ", "", true)).toEqual([]);
  });
  it("throws on malformed entries so bad configuration cannot silently widen trust", () => {
    expect(() =>
      trustedOriginsFrom("https://app.example.edu", "not a url", true),
    ).toThrow();
  });
});
