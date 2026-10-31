# CoursePulse — Smart Course Feedback & Analytics Portal

> **Project status: Phase 2 (system design) delivered for review. There is no application code yet.** Commands and file paths below describe the *planned* workflow and will be created in Phase 3 onward; do not expect them to run today.

CoursePulse collects structured, anonymous student feedback and turns it into course- and instructor-level insight, with separate experiences for **students**, **instructors** and **administrators**. Privacy is the central design constraint: student identity and feedback answers are stored separately and cannot be joined, and results are shown only after a form closes and only in aggregate above a minimum group size. (Anonymity here is logical separation, not cryptographic; limits are documented in `security.md`.)

## Planned features

Student dashboard and anonymous feedback submission · dynamic form builder (8 question types, 7 categories) · instructor analytics with trends, category performance and anonymized comments · admin dashboard, catalogue, roster and form management · course comparison · PDF/CSV/Excel reports · permission-aware search · audit logs · data-deletion workflow · cookie consent and privacy/terms pages · SEO-ready public site.

## Proposed technology stack

Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS · shadcn/ui · Lucide · Recharts · Framer Motion · React Hook Form · Zod · Prisma · PostgreSQL (RLS) · Better Auth (Argon2id) · Redis-backed rate limiting · Cloudflare Turnstile · transactional email provider · cookieless analytics (consent-gated) · Vitest · React Testing Library · Playwright · ESLint · gitleaks · Vercel + managed PostgreSQL. Rationale and trade-offs: [architecture.md](architecture.md), decisions D-01…D-25 in [docs/assumptions-and-decisions.md](docs/assumptions-and-decisions.md).

## Documentation map

| File | Purpose |
|---|---|
| [PRD.md](PRD.md) | requirements, personas, journeys, metrics |
| [architecture.md](architecture.md) | system and data architecture, ERD, anonymity design, deletion rules |
| [security.md](security.md) | security architecture, RLS matrix, risk register |
| [docs/api-specification.md](docs/api-specification.md) | endpoints and permissions |
| [docs/data-inventory.md](docs/data-inventory.md) | field-by-field data minimization record |
| [docs/assumptions-and-decisions.md](docs/assumptions-and-decisions.md) | decisions, assumptions, open questions |
| [prisma/schema.prisma](prisma/schema.prisma) | draft schema (22 models) |
| [prisma/sql/001_rls_and_permissions.draft.sql](prisma/sql/001_rls_and_permissions.draft.sql) | draft roles, RLS, constraints, anonymity functions (untested) |
| [codestyle.md](codestyle.md) · [AGENTS.md](AGENTS.md) · [plan.md](plan.md) | conventions, agent rules, roadmap |

## Prerequisites (planned)

Node.js LTS (version pinned in `.nvmrc`/`engines` in Phase 3) · pnpm · Docker (local PostgreSQL) · a PostgreSQL version supported by your managed provider (the design uses `gen_random_uuid()`, `pg_trgm`, RLS and `SECURITY DEFINER` functions) · accounts for: managed Postgres, email provider, Redis, Turnstile, analytics (see open questions in the decisions doc).

## Environment setup (planned)

1. Copy `.env.example` to `.env.local` and fill values (the example contains placeholders only; real secrets never go in Git or docs).
2. Variable groups: database URLs per role (`DATABASE_URL` = `cp_app`, `DATABASE_URL_AUTH`, `DATABASE_URL_MAINT`, `DATABASE_URL_MIGRATE` for operator/CI only), `AUTH_SECRET`, `CRON_SECRET`, email key, Redis credentials, Turnstile keys, site URL, institution contact details (optional; omitted from the UI if unset).
3. `config/env.ts` validates all variables at start-up and fails fast.

## Database setup, migrations, seed (planned)

```
pnpm db:up              # local Postgres container
pnpm db:migrate         # Prisma migrations + reviewed raw-SQL migrations (roles, RLS, functions) as owner
pnpm db:seed            # DEMO data only (labelled), refuses to run in production
pnpm admin:bootstrap -- --email you@example.edu   # first admin; emails an activation link; no default credentials
```
Runtime roles (`cp_app`, `cp_auth`, `cp_maint`) never own tables and are created by the migration; their passwords are supplied through your secret manager.

## Development workflow (planned)

```
pnpm dev                # local app
pnpm lint && pnpm typecheck
pnpm test               # unit + integration (real Postgres container for DB tests)
pnpm test:security      # rls, idor, csrf, anonymity, xss, headers, rate-limit
pnpm test:e2e           # Playwright (role flows, links/buttons crawl, mobile viewports)
pnpm build && pnpm start
```
Work proceeds phase by phase per [plan.md](plan.md); a change is done only when lint, type check, tests, security tests and the production build pass and docs are updated ([AGENTS.md](AGENTS.md)).

## Deployment (planned)

Vercel project + managed PostgreSQL over TLS; apply migrations from CI with the owner role; set runtime secrets per environment; configure the cron job for `/api/internal/maintenance`; verify HTTPS before enabling HSTS; run smoke tests and the final verification checklist. Preview deployments use throw-away databases with demo data only.

## API documentation

See [docs/api-specification.md](docs/api-specification.md). Authentication endpoints are served by Better Auth under `/api/auth/*` (allow-listed); all resource endpoints live under `/api/v1/*`.

## Security instructions

Read [security.md](security.md) and [AGENTS.md §4](AGENTS.md). Report vulnerabilities to the contact the institution publishes in `/.well-known/security.txt` (to be supplied; none is invented here). Never commit secrets; never log identifiers on the feedback-submission route.

## Troubleshooting (planned; extended as the system is built)

* *Boot fails with env validation error* → compare `.env.local` with `.env.example`; all required variables must be set.
* *Queries return no rows locally* → authenticated queries must run inside `withRls`; confirm the connection uses `cp_app`, not the owner.
* *Migration drift complaints from Prisma* → raw-SQL objects are managed by the reviewed SQL migrations (see R-09); do not auto-accept drops.
* *Rate limiting blocks local testing* → use the documented development override (disabled in production builds).

## Licence and legal

Licence to be chosen by the project owner. Privacy Policy, Terms and Refund Policy pages are drafts for institutional/legal review; nothing in this repository asserts legal compliance.
