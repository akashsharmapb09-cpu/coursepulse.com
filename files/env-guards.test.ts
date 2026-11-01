import { describe, expect, it } from "vitest";
import {
  findDisallowedPublicVars,
  findProductionProblems,
  findSecretValueReuse,
} from "@/config/env-guards";

describe("findDisallowedPublicVars", () => {
  it("allows only allow-listed public names", () => {
    expect(
      findDisallowedPublicVars({
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "x",
        NEXT_PUBLIC_CONTACT_EMAIL: "x",
      }),
    ).toEqual([]);
  });
  it("flags unknown and secret-looking public names", () => {
    const found = findDisallowedPublicVars({
      NEXT_PUBLIC_DATABASE_URL: "x",
      NEXT_PUBLIC_API_KEY: "x",
      NEXT_PUBLIC_FEATURE: "x",
      OTHER: "x",
    });
    expect(found).toEqual([
      "NEXT_PUBLIC_API_KEY (secret-like name)",
      "NEXT_PUBLIC_DATABASE_URL (secret-like name)",
      "NEXT_PUBLIC_FEATURE",
    ]);
  });
});

describe("findSecretValueReuse", () => {
  const secret = "s3cr3t-value-that-is-long-enough";
  it("detects a server secret copied into a public variable, reporting names only", () => {
    const leaks = findSecretValueReuse({
      AUTH_SECRET: secret,
      NEXT_PUBLIC_CONTACT_PHONE: `x${secret}`,
    });
    expect(leaks).toEqual([
      "NEXT_PUBLIC_CONTACT_PHONE contains the value of AUTH_SECRET",
    ]);
    expect(JSON.stringify(leaks)).not.toContain(secret);
  });
  it("ignores empty and short values", () => {
    expect(
      findSecretValueReuse({ AUTH_SECRET: "", NEXT_PUBLIC_CONTACT_PHONE: "" }),
    ).toEqual([]);
    expect(
      findSecretValueReuse({
        AUTH_SECRET: "abc",
        NEXT_PUBLIC_CONTACT_PHONE: "abc",
      }),
    ).toEqual([]);
  });
});

describe("findProductionProblems", () => {
  const good = {
    NODE_ENV: "production",
    SITE_URL: "https://app.example.edu",
    DATABASE_URL: "postgres://cp_app@h/db?sslmode=verify-full",
    DATABASE_URL_AUTH: "postgres://cp_auth@h/db?sslmode=require",
    DATABASE_URL_MAINT: "postgres://cp_maint@h/db?sslmode=require&x=1",
  };
  it("is silent outside production", () => {
    expect(
      findProductionProblems({
        NODE_ENV: "development",
        DEV_DISABLE_RATE_LIMIT: "true",
        DATABASE_URL_MIGRATE: "x",
      }),
    ).toEqual([]);
  });
  it("accepts a safe production configuration", () => {
    expect(findProductionProblems(good)).toEqual([]);
  });
  it("rejects the dev rate-limit bypass, owner credentials and non-https URLs", () => {
    const p = findProductionProblems({
      ...good,
      DEV_DISABLE_RATE_LIMIT: "true",
      DATABASE_URL_MIGRATE: "postgres://owner",
      SITE_URL: "http://x",
      TRUSTED_ORIGINS: "http://preview.example.edu, https://ok.example.edu",
    });
    expect(p.length).toBe(4);
  });
  it("requires TLS and distinct roles for database URLs", () => {
    expect(
      findProductionProblems({
        ...good,
        DATABASE_URL: "postgres://cp_app@h/db",
      }).length,
    ).toBe(1);
    expect(
      findProductionProblems({ ...good, DATABASE_URL_AUTH: good.DATABASE_URL })
        .length,
    ).toBe(1);
  });
});
