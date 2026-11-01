# CoursePulse — Smart Course Feedback & Analytics Portal

> **Current status:** the Phase 3 engineering foundation is in place and the GitHub CI pipeline is green. The product itself is **not ready for users**: the home page is a placeholder, and authentication, database migrations, dashboards, feedback workflows and analytics have not yet been implemented.

CoursePulse is intended to help an institution collect structured student feedback and provide privacy-preserving course and instructor insights. The approved design separates student eligibility from anonymous answers; the limits of that anonymity are documented in the architecture and security design. This repository must not describe the future product features as implemented until their code and tests exist.

## What exists today

- Next.js 16 App Router application shell, React 19 and strict TypeScript.
- Tailwind CSS v4 theme scaffold and shadcn/ui CLI configuration (`components.json`); no shadcn components have been generated yet.
- Zod-based server environment validation at application startup.
- Request proxy with nonce-based Content Security Policy, same-origin checks for API mutations, and private-route no-index/no-store headers.
- Minimal `/api/v1/health` endpoint.
- ESLint security/boundary rules, Prettier, Vitest, Playwright, Knip and Lefthook tooling.
- Local PostgreSQL Docker Compose service scaffold. It is not yet connected to application queries and has no applied migrations.
- GitHub Actions quality/build, responsive E2E and Gitleaks jobs.

The latest verified CI run is [GitHub Actions run #41275559130](https://github.com/akashsharmapb09-cpu/coursepulse.com/actions/runs/41275559130): quality/build passed, Gitleaks passed and Playwright passed **80/80 tests** across five viewport projects.

## Not implemented yet

- Better Auth, account activation, login, password recovery, sessions and role-based authorization.
- Applied Prisma migrations, database role creation, RLS policies, database clients or seed/bootstrap tooling.
- Student, instructor or administrator dashboards.
- Feedback form builder, anonymous feedback submission or submission confirmation.
- Live analytics, course comparisons, report exports or search.
- Email, Redis rate limiting, Turnstile or analytics-provider integrations.
- Privacy/consent workflows, legal pages and production deployment.

The `schema.prisma` file is a **design draft only**. It has not been validated or migrated. The project must not be used with real student data yet.

## Technology

**Installed foundation:** Next.js, React, TypeScript, Tailwind CSS, Zod, ESLint, Prettier, Vitest, Playwright, Knip and Lefthook.

**Planned for later phases:** Better Auth, Prisma/PostgreSQL with reviewed SQL/RLS migrations, React Hook Form, charting/report libraries, Redis, email, Turnstile and consent-gated analytics. Add dependencies when the corresponding feature is implemented; do not assume a planned integration is already connected.

## Repository documentation

| File | Purpose |
| --- | --- |
| [PRD.md](PRD.md) | Product requirements and user journeys |
| [architecture.md](architecture.md) | Architecture, data model and anonymity design |
| [security.md](security.md) | Security design, current baseline and remaining risks |
| [api-specification.md](api-specification.md) | Planned API contracts |
| [data-inventory.md](data-inventory.md) | Data minimization and field inventory |
| [assumptions-and-decisions.md](assumptions-and-decisions.md) | Decisions, assumptions and open questions |
| [schema.prisma](schema.prisma) | Draft database schema; not applied |
| [plan.md](plan.md) | Phase roadmap and exit criteria |
| [AGENTS.md](AGENTS.md) · [codestyle.md](codestyle.md) | Engineering and coding rules |

## Prerequisites

- Node.js **24.22.1** (pinned in the repository-root `.nvmrc`).
- pnpm **12.16.1** (pinned by `packageManager` in `package.json`).
- Docker Desktop only when you want to start the local PostgreSQL container.
- Gitleaks on your `PATH` for the local pre-commit secret scan.

## Local setup

Run commands from the `files/` directory unless stated otherwise.

1. Copy `.env.example` to `.env`.
   - PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
2. Edit `.env` and replace `LOCAL_DB_PASSWORD` with a long, unique local-only password before starting Docker Compose.
3. Install the locked dependencies: `pnpm install --frozen-lockfile`.
4. Start the Next.js app: `pnpm dev`.
5. Optional local database container: `pnpm db:up`; stop it with `pnpm db:down`.

The current application shell does not query PostgreSQL, so the database container is optional at this stage. Starting it does **not** apply the draft Prisma schema or create the planned least-privilege runtime roles. Do not use the Compose superuser for a future application runtime.

## Environment variables

The committed `.env.example` contains placeholders and local-only settings, never production credentials.

- `SITE_URL` is required by the current environment validator and must not end in a slash. Use `http://localhost:3000` locally and an HTTPS URL in production.
- `TRUSTED_ORIGINS` is an optional comma-separated list; production entries must use HTTPS.
- `LOCAL_DB_PASSWORD` is required only by the local Docker Compose database service.
- In production, the current validator requires distinct TLS-enabled `DATABASE_URL`, `DATABASE_URL_AUTH` and `DATABASE_URL_MAINT` values, plus `AUTH_SECRET`, `CRON_SECRET` and `RATE_LIMIT_KEY_SECRET`.
- `DATABASE_URL_MIGRATE` is reserved for a separate migration/operator environment and must not be present in the production application runtime.
- Email, Redis and Turnstile variables are optional until those integrations are implemented. Do not add empty values for optional strings; leave unused entries commented out.
- Only the four documented `NEXT_PUBLIC_*` names in `src/config/env-guards.ts` are allow-listed. Server secrets must never use the `NEXT_PUBLIC_` prefix.

Generate each future secret independently (for example, `openssl rand -base64 48`). Store real values in a secret manager or untracked local `.env`, never in GitHub source, documentation, screenshots or logs.

## Available commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start local Next.js development server |
| `pnpm format:check` / `pnpm format` | Check / apply Prettier |
| `pnpm lint` | ESLint |
| `pnpm check:conventions` | Additional AST-based project/security conventions |
| `pnpm typecheck` | TypeScript check |
| `pnpm test` | Unit tests |
| `pnpm test:security` | Environment, origin, CSP and header tests |
| `pnpm test:e2e` | Playwright responsive smoke tests |
| `pnpm check:unused` | Knip unused-code/dependency analysis |
| `pnpm audit:deps` | Dependency audit gate (fails on high/critical findings) |
| `pnpm build` / `pnpm start` | Production build / server |
| `pnpm db:up` / `pnpm db:down` | Local PostgreSQL container only |

## Git hooks and CI

The repository configures Lefthook to scan staged changes with Gitleaks before a commit. Install Gitleaks locally and make sure the `gitleaks` executable is on `PATH`; the hook intentionally fails closed when it is missing. After pulling updates, run `pnpm install --frozen-lockfile` from `files/` so the `prepare` script installs the Git hook. GitHub Actions independently runs the full-history Gitleaks scan and the quality/build/E2E pipeline.

The full dependency audit currently reports one **moderate** development-tool dependency advisory. The CI audit gate is configured to fail on high/critical severity; the production-only dependency audit was clean at the last local check. This is not a claim that the complete dependency tree is vulnerability-free.

## Deployment status

No Vercel project, production database, domain, email provider, Redis, Turnstile or analytics provider is connected by this repository setup. Production deployment and verification belong to Phase 20 and must not be inferred from a green CI run.

## Security and legal

Read [security.md](security.md) before changing security-sensitive code. Current security controls are a baseline, not a completed security review or a claim of regulatory compliance. Product privacy, Terms and any payment-related policies require institution-specific and qualified legal review before launch.

The product owner must provide verified institutional contact details and any security-reporting contact; this repository does not invent them.

## Licence

The project is currently marked `UNLICENSED`. A licence and institutional ownership terms must be decided by the project owner.
