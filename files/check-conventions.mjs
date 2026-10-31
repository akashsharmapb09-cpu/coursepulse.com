#!/usr/bin/env node
/**
 * Convention and security guard built on the TypeScript compiler API (AST-based, not regex-on-text).
 * It mirrors the ESLint bans in eslint.config.mjs so the most important rules are enforced twice, and it has a
 * self-test (`--self-test`) so the guard itself is verified. Rules: see codestyle.md §4, security.md, AGENTS.md §4.
 *
 *   node scripts/check-conventions.mjs              scan the repository
 *   node scripts/check-conventions.mjs --self-test  verify the rules against known-bad / known-good snippets
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import ts from "typescript";

const SELF = "scripts/check-conventions.mjs";
const SCAN_ROOTS = ["src", "tests", "scripts", "prisma"];
const EXTENSIONS = /\.(ts|tsx|mts|mjs|js|jsx)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "coverage",
  "playwright-report",
  "test-results",
  ".git",
]);

const isPrisma = (s) =>
  s === "@prisma/client" || s.startsWith("@prisma/client/");
const isDb = (s) => s === "@/lib/db" || s.startsWith("@/lib/db/");
const envAllowed = (f) => {
  const n = f.replace(/\\/g, "/");
  return n.includes("src/config/") || n.includes("config/env") || n.endsWith("env.ts") || n.includes("instrumentation") || n.includes("proxy") || n.includes(".config.") || n.includes("tests/") || n.includes("scripts/") || n.includes(".test.") || n.includes("env.test") || n.includes("check-conventions");
};
/** Resolve a relative import to its "@/..." form so ../../ tricks cannot dodge boundary rules. */
function canonicalSpec(file, spec) {
  if (!spec.startsWith(".")) return spec;
  const joined = posix.join(posix.dirname(file), spec);
  return joined.startsWith("src/") ? `@/${joined.slice(4)}` : joined;
}

export function readPublicAllowlist(envGuardsSource) {
  const block = envGuardsSource.match(
    /PUBLIC_ENV_ALLOWLIST\s*=\s*\[([\s\S]*?)\]/,
  );
  return block
    ? [...block[1].matchAll(/"(NEXT_PUBLIC_[A-Z0-9_]+)"/g)].map((m) => m[1])
    : [];
}

/** Path-level rule: public self-registration must not exist (decision D-02, owner-confirmed). */
export function checkPath(file) {
  const segment = file
    .split("/")
    .find((s) => /^\(?(sign-?up|register)\)?$/i.test(s));
  return file.startsWith("src/app/") && segment
    ? [
        {
          file,
          line: 1,
          rule: "no-self-registration",
          msg: `route segment "${segment}" is forbidden: accounts are admin-provisioned only (D-02)`,
        },
      ]
    : [];
}

export function checkSource(file, text, ctx = { publicAllow: [] }) {
  const kind =
    file.endsWith("x") && !file.endsWith(".mjs")
      ? ts.ScriptKind.TSX
      : /\.m?js$/.test(file)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const violations = [];
  const add = (node, rule, msg) =>
    violations.push({
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      rule,
      msg,
    });
  const isClient = sf.statements.some(
    (s) =>
      ts.isExpressionStatement(s) &&
      ts.isStringLiteral(s.expression) &&
      s.expression.text === "use client",
  );

  const checkImport = (rawSpec, node) => {
    const spec = canonicalSpec(file, rawSpec);
    if ((isPrisma(spec) || isDb(spec)) && !dbAllowed(file))
      add(
        node,
        "db-boundary",
        `"${rawSpec}": database access only from lib/db, lib/auth and services/*.queries.ts`,
      );
    if (
      file.startsWith("src/components/") &&
      (spec.startsWith("@/services") ||
        spec === "server-only" ||
        spec === "@/config/env")
    )
      add(
        node,
        "components-boundary",
        `"${rawSpec}": components must not import server code`,
      );
    if (
      file.startsWith("src/services/") &&
      (spec === "next/headers" ||
        spec === "next/server" ||
        spec.startsWith("@/components") ||
        spec.startsWith("@/app"))
    )
      add(
        node,
        "services-boundary",
        `"${rawSpec}": services take an explicit actor/input, never Request/cookies/UI`,
      );
    if (
      isClient &&
      (spec === "server-only" ||
        spec === "@/config/env" ||
        spec.startsWith("@/services") ||
        isDb(spec) ||
        isPrisma(spec))
    )
      add(
        node,
        "client-boundary",
        `"${rawSpec}": a "use client" file must not import server-only modules`,
      );
  };

  const visit = (node) => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (name === "dangerouslySetInnerHTML")
        add(
          node,
          "no-dangerously-set-html",
          "user content must render as text (security.md §11)",
        );
      if (name === "href") {
        const init = node.initializer;
        const lit =
          init && ts.isStringLiteral(init)
            ? init
            : init &&
                ts.isJsxExpression(init) &&
                init.expression &&
                ts.isStringLiteralLike(init.expression)
              ? init.expression
              : undefined;
        if (lit && (lit.text === "#" || lit.text === ""))
          add(
            node,
            "no-placeholder-href",
            'placeholder href ("#" or empty) is forbidden: every link must have a real destination',
          );
      }
    }
    if (
      (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) &&
      /^\$(queryRaw|executeRaw)Unsafe$/.test(node.text)
    )
      add(
        node,
        "no-unsafe-raw-sql",
        "use Prisma.sql tagged templates (parameterized) instead",
      );
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "eval" || node.expression.text === "Function")
    )
      add(node, "no-eval", "eval/Function are forbidden");
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Function"
    )
      add(node, "no-eval", "new Function is forbidden");

    const processEnv =
      (ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "process" &&
        node.name.text === "env") ||
      (ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "process" &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === "env");
    if (processEnv && !envAllowed(file))
      add(
        node,
        "env-access",
        "read configuration through src/config/env.ts, not process.env",
      );

    if (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) {
      const text = node.text;
      const nf = file.replace(/\\/g, "/");
if (/^NEXT_PUBLIC_[A-Z0-9_]+$/.test(text) && !ctx.publicAllow.includes(text) && !nf.includes("tests/") && !nf.includes("scripts/") && !nf.includes(".test.") && !nf.includes("env.test") && !nf.includes("__tests__") && !nf.includes("check-conventions"))
        add(
          node,
          "public-env-allowlist",
          `${text} is not on PUBLIC_ENV_ALLOWLIST`,
        );
    }

    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      checkImport(node.moduleSpecifier.text, node);
    if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const callee = node.expression;
      if (
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require")
      )
        checkImport(node.arguments[0].text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTENSIONS.test(name)) yield full;
  }
}

function scan(root) {
  const guards = join(root, "src/config/env-guards.ts");
  let publicAllow = [];
  try {
    publicAllow = readPublicAllowlist(readFileSync(guards, "utf8"));
  } catch {
    /* guards not present yet */
  }
  const files = [];
  for (const r of SCAN_ROOTS) {
    try {
      files.push(...walk(join(root, r)));
    } catch {
      /* optional root */
    }
  }
  for (const name of readdirSync(root))
    if (EXTENSIONS.test(name)) files.push(join(root, name));
  const violations = [];
  for (const abs of files) {
    const file = relative(root, abs).split(sep).join("/");
    if (file === SELF) continue;
    violations.push(
      ...checkPath(file),
      ...checkSource(file, readFileSync(abs, "utf8"), { publicAllow }),
    );
  }
  return { violations, scanned: files.length, publicAllow };
}

function selfTest() {
  const allow = ["NEXT_PUBLIC_CONTACT_EMAIL"];
  const rules = (file, code) =>
    [
      ...new Set(
        checkSource(file, code, { publicAllow: allow }).map((v) => v.rule),
      ),
    ].sort();
  const cases = [
    [
      "src/components/a.tsx",
      "export const A=()=> <div dangerouslySetInnerHTML={{__html:x}}/>;",
      ["no-dangerously-set-html"],
    ],
    [
      "src/components/a.tsx",
      'export const A=()=> <a href="#">x</a>;',
      ["no-placeholder-href"],
    ],
    [
      "src/components/a.tsx",
      "export const A=()=> <a href={'#'}>x</a>;",
      ["no-placeholder-href"],
    ],
    ["src/components/a.tsx", 'export const A=()=> <a href="/about">x</a>;', []],
    [
      "src/services/x/x.queries.ts",
      "db.$queryRawUnsafe(q);",
      ["no-unsafe-raw-sql"],
    ],
    [
      "src/services/x/x.queries.ts",
      'db["$executeRawUnsafe"](q);',
      ["no-unsafe-raw-sql"],
    ],
    ["src/services/x/x.queries.ts", "db.$queryRaw`select 1`;", []],
    ["src/lib/x.ts", "eval('1');", ["no-eval"]],
    ["src/lib/x.ts", "new Function('return 1');", ["no-eval"]],
    ["src/lib/x.ts", "const k = process.env.SECRET;", ["env-access"]],
    ["src/lib/x.ts", "const k = process['env'];", ["env-access"]],
    ["src/config/env.ts", "const k = process.env;", []],
    ["src/proxy.ts", "const k = process.env.NODE_ENV;", []],
    ["next.config.ts", "const k = process.env.NODE_ENV;", []],
    [
      "src/lib/x.ts",
      "const k = 'NEXT_PUBLIC_SECRET_THING';",
      ["public-env-allowlist"],
    ],
    ["src/lib/x.ts", "const k = 'NEXT_PUBLIC_CONTACT_EMAIL';", []],
    ["src/components/a.tsx", "import { db } from '@/lib/db';", ["db-boundary"]],
    [
      "src/components/ui/a.tsx",
      "import { x } from '../../services/forms/forms.service';",
      ["components-boundary"],
    ],
    ["src/components/ui/a.tsx", "import { x } from './local';", []],
    ["src/components/a.tsx", "import 'server-only';", ["components-boundary"]],
    [
      "src/app/page.tsx",
      "import { PrismaClient } from '@prisma/client';",
      ["db-boundary"],
    ],
    [
      "src/app/page.tsx",
      "const m = await import('@prisma/client');",
      ["db-boundary"],
    ],
    [
      "src/services/forms/forms.queries.ts",
      "import { PrismaClient } from '@prisma/client';",
      [],
    ],
    [
      "src/services/forms/forms.service.ts",
      "import { PrismaClient } from '@prisma/client';",
      ["db-boundary"],
    ],
    [
      "src/services/forms/forms.service.ts",
      "import { cookies } from 'next/headers';",
      ["services-boundary"],
    ],
    [
      "src/services/forms/forms.service.ts",
      "import { Card } from '@/components/ui/card';",
      ["services-boundary"],
    ],
    [
      "src/lib/ui/x.tsx",
      "'use client';\nimport { getServerEnv } from '@/config/env';",
      ["client-boundary"],
    ],
    ["src/lib/ui/x.tsx", "import { getServerEnv } from '@/config/env';", []],
    [
      "src/lib/ui/x.tsx",
      "'use client';\nimport { PUBLIC_ENV_ALLOWLIST } from '@/config/env-guards';",
      [],
    ],
  ];
  for (const [file, code, expected] of cases)
    assert.deepEqual(rules(file, code), expected, `${file}: ${code}`);
  for (const bad of [
    "src/app/register/page.tsx",
    "src/app/(public)/sign-up/page.tsx",
    "src/app/signup/route.ts",
    "src/app/api/v1/register/route.ts",
  ])
    assert.equal(checkPath(bad).length, 1, bad);
  for (const ok of [
    "src/app/(public)/activate/page.tsx",
    "src/app/admin/users/page.tsx",
    "tests/e2e/register.spec.ts",
  ])
    assert.equal(checkPath(ok).length, 0, ok);
  assert.deepEqual(
    readPublicAllowlist(
      'export const PUBLIC_ENV_ALLOWLIST = [\n "NEXT_PUBLIC_A_B",\n "NEXT_PUBLIC_C",\n] as const;',
    ),
    ["NEXT_PUBLIC_A_B", "NEXT_PUBLIC_C"],
  );
  // eslint-disable-next-line no-console
  console.log(`self-test OK: ${cases.length} source cases + path cases`);
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.argv.includes("--self-test")) selfTest();
  else {
      const { violations, scanned, publicAllow } = scan(process.cwd());
  for (const v of violations) {
    console.error(`${v.file}:${v.line} [${v.rule}] ${v.msg}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `conventions: scanned ${scanned} files, public allow-list ${publicAllow.length} names, ${violations.length} violations`
  );
  process.exit(violations.length ? 1 : 0);
 }
}