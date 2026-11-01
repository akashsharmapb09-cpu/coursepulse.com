# CoursePulse — Code Style and Conventions

> Applies from Phase 3. Where tooling can enforce a rule (ESLint, TypeScript, Prettier, CI), it must; this document explains the intent.

## 1. Stack

Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS · shadcn/ui · Lucide · Recharts · Framer Motion · React Hook Form · Zod · Prisma · PostgreSQL · Better Auth · Vitest · React Testing Library · Playwright. Versions are pinned exactly in `package.json` and the lockfile; upgrades happen in dedicated PRs.

## 2. Files and folders

- Layout per `architecture.md §4`. A folder exists only when it has a real file.
- Files: `kebab-case.ts(x)`. React components: `PascalCase` exports, one primary component per file. Route segments follow Next.js conventions.
- Services: `services/<domain>/<domain>.service.ts` (use cases), `.schemas.ts` (Zod, client-safe), `.policies.ts` (object-level rules), `.queries.ts` (data access, only file type allowed to touch Prisma besides `lib/db`).
- Tests mirror source: `tests/unit|integration|e2e|security/...`, named `*.test.ts` / `*.spec.ts` (Playwright).
- Server-only modules start with `import "server-only"`.

## 3. Naming

- Variables/functions `camelCase`; types/interfaces/enums/components `PascalCase`; constants `SCREAMING_SNAKE_CASE` only for true constants; Zod schemas `fooSchema` with inferred type `Foo`.
- Booleans read as predicates (`isActive`, `hasConsent`, `canExport`). Functions are verbs (`submitFeedback`, `getAssignmentAnalytics`).
- Database: tables `snake_case` plural, columns `snake_case`, enums `snake_case` type names with `UPPER_CASE` values; Prisma models singular `PascalCase` with `@map`/`@@map`.
- API: kebab-case paths, plural nouns, verbs only for state transitions (`/activate`, `/close`).
- Audit actions: `RESOURCE_VERB_PAST` constants in one file (`USER_ROLE_CHANGED`).

## 4. Formatting and linting

Prettier (default config, 100 cols, no semicolon debates — the repo config wins) and ESLint (Next, TypeScript-ESLint strict, jsx-a11y, import order, boundaries). CI fails on warnings. No commented-out code. Imports: absolute alias `@/…`, no deep relative `../../..` chains.

Custom rules (must exist before feature work): ban `dangerouslySetInnerHTML`, `$queryRawUnsafe`, `$executeRawUnsafe`, `eval`/`new Function`; ban `NEXT_PUBLIC_` env names that look like secrets; forbid importing `lib/db`, `services/**`, `server-only` modules from `components/**`; forbid Prisma client use outside `lib/db`/`*.queries.ts`.

## 5. TypeScript

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. No `any` (use `unknown` + narrowing); no non-null `!` without a comment; no `@ts-ignore` (use `@ts-expect-error` with reason).
- Parse, don't validate: external data (requests, env, JSON columns, third-party responses) enters through Zod and becomes typed values; internal code trusts types.
- Prefer discriminated unions and `satisfies`; exhaustive `switch` with a `never` check on enums (roles, statuses, question types).
- Branded ID types for `UserId`, `FormId`, etc. where cross-wiring is plausible.
- Dates: `Date`/ISO strings in UTC across boundaries; formatting only at the UI edge with the institution time zone.

## 6. Components and UI

- Server Components by default; `"use client"` only for interactivity. Client bundles must not import server code.
- Presentational components are pure and prop-driven; data fetching lives in pages/services. Charts and animation are dynamically imported.
- Accessibility is part of "done": semantic elements, labels bound to inputs, visible focus, `aria-live` for form errors, keyboard operability, `prefers-reduced-motion`, one `<h1>` per page and a logical heading order, alt text on images.
- Styling: Tailwind utilities with design tokens from the brief's palette (CSS variables); no inline hard-coded colours; never rely on colour alone; no fixed pixel widths that can overflow on 320 px screens; wide tables/charts sit in `overflow-x-auto` wrappers.
- Every async UI has loading (skeleton), empty, error and success states. Buttons that submit are disabled while pending and show progress.
- Forms: React Hook Form + the same Zod schema as the server; show field-level errors; never log field values.
- No `href="#"`, no inert buttons, no placeholder lorem ipsum, no invented contact data.

## 7. Backend and data

- Handlers use the `route()` wrapper (origin check → rate limit → auth → permission → validation → service → envelope). Handlers contain no business logic.
- Services take `(actor, input)` and return typed results or throw typed domain errors (`NotFoundError`, `ConflictError`, `ValidationError`, `ForbiddenError`) mapped centrally to problem+json.
- All authenticated database work happens in `withRls(actor, tx => …)`. Never fetch a user-addressed resource by bare id — use scope helpers.
- Raw SQL only via `Prisma.sql` tagged templates with parameters; analytics and anonymous-data access only through the `app.*` functions.
- Transactions for multi-step writes; idempotent jobs; explicit `select` lists (no `select *` shapes leaking columns); pagination on every list.
- Logging: structured, `requestId`, no bodies, no secrets, no user id on the feedback-submission route.

## 7a. Security-sensitive coding rules (summary of `security.md`)

Validate every input with `.strict()` schemas; never accept role/status/ids-of-others from clients; return 404 for invisible objects; generic auth errors; never compare secrets with `===` (constant-time); never put tokens in URLs that are logged; text from users is plain text.

## 8. Comments and documentation

Comment _why_, not _what_. Each service exports a short JSDoc on public use cases stating authorization and release rules. Security-relevant decisions link to the decision/risk ID (`// D-06`, `// R-04`). Update docs in the same PR as behaviour changes. Public API changes update `docs/api-specification.md`.

## 9. Testing conventions

Arrange-Act-Assert; one behaviour per test; tests use real Postgres (container) for anything touching RLS, constraints or functions — **no mocking of the database for security tests**; factories create minimal valid data; no shared mutable state; deterministic clocks; security suites named by control (`rls`, `idor`, `csrf`, `anonymity`). A bug fix starts with a failing test.

## 10. Git and review

Conventional Commits; small PRs; CI required (lint, typecheck, test, build, audit, secret scan); changes touching auth, RLS, anonymity, exports or settings need an explicit security-review checklist in the PR description; migrations are reviewed SQL, never auto-generated blind.

## 11. Reusable-code guidelines

Extract after the second real use, not before; shared helpers live in `lib/`; avoid generic "utils" dumping grounds — name modules by capability (`lib/security/origin-check.ts`). Prefer composition and small pure functions; avoid unnecessary abstractions, wrapper layers and speculative configuration.
