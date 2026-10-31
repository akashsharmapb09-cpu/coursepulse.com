// ESLint flat config (ESLint 9 + eslint-config-next 16). Conventions: codestyle.md §4; security rules: security.md.
// The most important bans are ALSO enforced by scripts/check-conventions.mjs (AST-based, self-tested) in CI.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const banned = [
  { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "User content renders as text only (security.md §11)." },
  { selector: "JSXAttribute[name.name='href'][value.value='#']", message: "Placeholder href is forbidden: every link needs a real destination." },
  { selector: "Identifier[name='$queryRawUnsafe']", message: "Use Prisma.sql tagged templates (parameterized)." },
  { selector: "Identifier[name='$executeRawUnsafe']", message: "Use Prisma.sql tagged templates (parameterized)." },
  { selector: "CallExpression[callee.name='eval']", message: "eval is forbidden." },
  { selector: "NewExpression[callee.name='Function']", message: "new Function is forbidden." },
];
const processEnv = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message: "Read configuration through src/config/env.ts (validated), not process.env.",
};

const prismaPatterns = ["@prisma/client", "@prisma/client/*"];
const dbPatterns = ["@/lib/db", "@/lib/db/*"];

const restrict = (...patterns) => ["error", { patterns: patterns.map((group) => ({ group, message: "Violates module boundaries (architecture.md §3)." })) }];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts", "node_modules/**"]),
  {
    files: ["**/*.{ts,tsx,mts,mjs}"],
    rules: {
      "no-restricted-syntax": ["error", ...banned, processEnv],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports" }],
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description", "ts-ignore": true, "ts-nocheck": true, minimumDescriptionLength: 10 }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      "no-restricted-imports": restrict(prismaPatterns, dbPatterns),
    },
  },
  // UI code: no server modules, no database.
  {
    files: ["src/components/**", "src/hooks/**"],
    rules: { "no-restricted-imports": restrict(prismaPatterns, dbPatterns, ["@/services/*"], ["server-only"], ["@/config/env"]) },
  },
  // Services: explicit actor/input only; Prisma allowed only in *.queries.ts (override below).
  {
    files: ["src/services/**"],
    rules: { "no-restricted-imports": restrict(prismaPatterns, ["next/headers", "next/server", "@/components/*", "@/app/*"]) },
  },
  { files: ["src/services/**/*.queries.ts"], rules: { "no-restricted-imports": restrict(["next/headers", "next/server", "@/components/*", "@/app/*"]) } },
  { files: ["src/lib/db/**", "src/lib/auth/**", "tests/**", "prisma/**", "scripts/**"], rules: { "no-restricted-imports": "off" } },
  // Configuration and tooling may read process.env.
  {
    files: ["src/config/**", "src/instrumentation.ts", "src/proxy.ts", "*.config.{ts,mts,mjs}", "tests/**", "scripts/**"],
    rules: { "no-restricted-syntax": ["error", ...banned] },
  },
  { files: ["scripts/**", "tests/e2e/**"], rules: { "no-console": "off" } },
]);
