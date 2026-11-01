import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/config/env";

const dev = { NODE_ENV: "development", SITE_URL: "http://localhost:3000" };
const secret = (c: string) => c.repeat(40);
const prod = {
  NODE_ENV: "production",
  SITE_URL: "https://app.example.edu",
  DATABASE_URL: "postgres://cp_app@h/db?sslmode=verify-full",
  DATABASE_URL_AUTH: "postgres://cp_auth@h/db?sslmode=verify-full",
  DATABASE_URL_MAINT: "postgres://cp_maint@h/db?sslmode=verify-full",
  AUTH_SECRET: secret("a"),
  CRON_SECRET: secret("b"),
  RATE_LIMIT_KEY_SECRET: secret("c"),
};

function failure(env: Record<string, string>): string {
  try {
    parseServerEnv(env);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected parseServerEnv to throw");
}

describe("parseServerEnv", () => {
  it("accepts a minimal development environment", () => {
    const env = parseServerEnv(dev);
    expect(env.DEV_DISABLE_RATE_LIMIT).toBe("false");
    expect(env.TRUSTED_ORIGIN_LIST).toEqual([]);
  });
  it("accepts a complete production environment", () => {
    expect(parseServerEnv(prod).NODE_ENV).toBe("production");
  });
  it("fails fast on missing or malformed core variables", () => {
    expect(failure({ SITE_URL: "http://localhost:3000" })).toContain(
      "NODE_ENV",
    );
    expect(failure({ ...dev, SITE_URL: "http://localhost:3000/" })).toContain(
      "SITE_URL",
    );
    expect(failure({ ...dev, SITE_URL: "not a url" })).toContain("SITE_URL");
  });
  it("requires production secrets and names them", () => {
    const withoutSecret: Record<string, string> = { ...prod };
    delete withoutSecret["AUTH_SECRET"];
    expect(failure(withoutSecret)).toContain(
      "AUTH_SECRET: required in production",
    );
  });
  it("rejects non-allow-listed NEXT_PUBLIC_ variables", () => {
    expect(failure({ ...dev, NEXT_PUBLIC_DATABASE_URL: "x" })).toContain(
      "NEXT_PUBLIC_DATABASE_URL",
    );
  });
  it("never echoes secret values in error messages", () => {
    const message = failure({
      ...prod,
      AUTH_SECRET: "short-secret-value",
      DEV_DISABLE_RATE_LIMIT: "true",
    });
    expect(message).toContain("AUTH_SECRET");
    expect(message).not.toContain("short-secret-value");
  });
});
