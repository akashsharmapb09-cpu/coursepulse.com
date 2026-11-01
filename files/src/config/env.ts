import "server-only";
import { z } from "zod";
import {
  findDisallowedPublicVars,
  findProductionProblems,
  findSecretValueReuse,
  type EnvRecord,
} from "./env-guards";

/**
 * Validated server environment. Fails fast (at boot via instrumentation.ts) with a message that lists variable
 * NAMES and rule descriptions only â€” never values (security.md Â§7).
 *
 * Phase 3 note: database/auth/third-party variables are optional outside production because no code consumes
 * them yet; each later phase tightens its own variables to "required" in the same change that starts using them.
 */

const optionalString = z.string().trim().min(1).optional();
const optionalUrl = z.string().trim().url().optional();

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  SITE_URL: z
    .string()
    .trim()
    .url()
    .refine((value) => !value.endsWith("/"), "must not end with a slash"),
  TRUSTED_ORIGINS: z.string().default(""),

  DATABASE_URL: optionalString,
  DATABASE_URL_AUTH: optionalString,
  DATABASE_URL_MAINT: optionalString,
  DATABASE_URL_MIGRATE: optionalString,

  AUTH_SECRET: z
    .string()
    .min(
      32,
      "must be at least 32 characters (generate with: openssl rand -base64 32)",
    )
    .optional(),
  CRON_SECRET: z.string().min(32, "must be at least 32 characters").optional(),
  RATE_LIMIT_KEY_SECRET: z
    .string()
    .min(32, "must be at least 32 characters")
    .optional(),

  EMAIL_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  RATE_LIMIT_REDIS_URL: optionalUrl,
  RATE_LIMIT_REDIS_TOKEN: optionalString,
  TURNSTILE_SECRET_KEY: optionalString,
  DEV_DISABLE_RATE_LIMIT: z.enum(["true", "false"]).default("false"),
});

const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "DATABASE_URL_AUTH",
  "DATABASE_URL_MAINT",
  "AUTH_SECRET",
  "CRON_SECRET",
  "RATE_LIMIT_KEY_SECRET",
] as const;

export type ServerEnv = z.infer<typeof serverSchema> & {
  TRUSTED_ORIGIN_LIST: string[];
};

export function parseServerEnv(raw: EnvRecord): ServerEnv {
  const problems: string[] = [];

  const parsed = serverSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  }

  const isProduction = raw["NODE_ENV"] === "production";
  if (isProduction) {
    for (const name of REQUIRED_IN_PRODUCTION) {
      if (!raw[name]) problems.push(`${name}: required in production`);
    }
  }
  problems.push(...findProductionProblems(raw));
  problems.push(
    ...findDisallowedPublicVars(raw).map(
      (n) => `${n}: not on the public-variable allow-list`,
    ),
  );
  problems.push(...findSecretValueReuse(raw));

  if (problems.length > 0 || !parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n - ${problems.join("\n - ")}`,
    );
  }

  const trustedList = parsed.data.TRUSTED_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return { ...parsed.data, TRUSTED_ORIGIN_LIST: trustedList };
}

let cached: ServerEnv | undefined;

/** Validated environment, parsed once per process. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
