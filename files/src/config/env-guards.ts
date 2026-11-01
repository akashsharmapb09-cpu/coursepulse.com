/**
 * Pure environment-safety checks (no dependencies, edge/node safe, unit-testable).
 * They inspect variable NAMES and, for reuse detection, compare values — but never return or log a value.
 * See security.md §7.
 */

export type EnvRecord = Readonly<Record<string, string | undefined>>;

/** The only NEXT_PUBLIC_* variables allowed in the browser bundle. Adding one is a reviewed security change. */
export const PUBLIC_ENV_ALLOWLIST = [
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "NEXT_PUBLIC_ANALYTICS_DOMAIN",
  "NEXT_PUBLIC_CONTACT_EMAIL",
  "NEXT_PUBLIC_CONTACT_PHONE",
] as const;

const PUBLIC_ALLOWED = new Set<string>(PUBLIC_ENV_ALLOWLIST);
const SECRET_LIKE =
  /(SECRET|PASSWORD|TOKEN|PRIVATE|DATABASE|CRON|API_?KEY|CREDENTIAL)/i;

/** Variables whose values must never appear in a public variable or in logs. */
export const SERVER_SECRET_NAMES = [
  "DATABASE_URL",
  "DATABASE_URL_AUTH",
  "DATABASE_URL_MAINT",
  "DATABASE_URL_MIGRATE",
  "AUTH_SECRET",
  "CRON_SECRET",
  "RATE_LIMIT_KEY_SECRET",
  "EMAIL_API_KEY",
  "RATE_LIMIT_REDIS_TOKEN",
  "TURNSTILE_SECRET_KEY",
] as const;

/** NEXT_PUBLIC_* names that are not on the allow-list. Secret-looking names are flagged explicitly. */
export function findDisallowedPublicVars(env: EnvRecord): string[] {
  return Object.keys(env)
    .filter(
      (name) => name.startsWith("NEXT_PUBLIC_") && !PUBLIC_ALLOWED.has(name),
    )
    .map((name) =>
      SECRET_LIKE.test(name) ? `${name} (secret-like name)` : name,
    )
    .sort();
}

/** Public variables whose value equals a server secret's value (copy/paste leak). Returns variable names only. */
export function findSecretValueReuse(env: EnvRecord): string[] {
  const secretValues = new Map<string, string>();
  for (const name of SERVER_SECRET_NAMES) {
    const value = env[name];
    if (value !== undefined && value.length >= 8) secretValues.set(value, name);
  }
  const leaks: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (
      !name.startsWith("NEXT_PUBLIC_") ||
      value === undefined ||
      value.length < 8
    )
      continue;
    for (const secret of secretValues.keys()) {
      if (value.includes(secret))
        leaks.push(`${name} contains the value of ${secretValues.get(secret)}`);
    }
  }
  return leaks.sort();
}

const SSL_MODE = /[?&]sslmode=(require|verify-ca|verify-full)(&|$)/i;

/** Problems that make a PRODUCTION configuration unsafe. Empty array = no problems found. */
export function findProductionProblems(env: EnvRecord): string[] {
  if (env["NODE_ENV"] !== "production") return [];
  const problems: string[] = [];

  if (env["DEV_DISABLE_RATE_LIMIT"] === "true")
    problems.push("DEV_DISABLE_RATE_LIMIT must not be true in production");
  if (env["DATABASE_URL_MIGRATE"])
    problems.push(
      "DATABASE_URL_MIGRATE (owner role) must not be set in the runtime environment",
    );
  if (!env["SITE_URL"]?.startsWith("https://"))
    problems.push("SITE_URL must use https in production");

  for (const origin of (env["TRUSTED_ORIGINS"] ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)) {
    if (!origin.startsWith("https://"))
      problems.push("TRUSTED_ORIGINS entries must use https in production");
  }
  for (const name of [
    "DATABASE_URL",
    "DATABASE_URL_AUTH",
    "DATABASE_URL_MAINT",
  ] as const) {
    const url = env[name];
    if (url && !SSL_MODE.test(url))
      problems.push(
        `${name} must request TLS (sslmode=require or verify-full)`,
      );
  }
  const roleUrls = ["DATABASE_URL", "DATABASE_URL_AUTH", "DATABASE_URL_MAINT"]
    .map((n) => env[n])
    .filter(Boolean);
  if (new Set(roleUrls).size !== roleUrls.length)
    problems.push(
      "database role connection strings must be distinct (cp_app, cp_auth, cp_maint)",
    );

  return problems;
}
