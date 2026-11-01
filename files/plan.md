# CoursePulse — Development Plan

> Phases follow the master prompt (§23). Each phase must reach its **exit criteria with evidence** before the next starts. Phase 2 (this design) is complete pending your review; **Phase 3 does not begin until you approve.**

Legend: ☐ not started · ◐ in progress · ☑ done. Spikes are time-boxed experiments to retire risks early.

| #    | Phase                              | Status                                                                                             |
| ---- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1    | Existing project inspection        | ☑ N/A — project is greenfield (no repo to audit); audit checklist moves to CI templates in Phase 3 |
| 2    | PRD, architecture, DB design, plan | ◐ delivered for review                                                                             |
| 3–20 | see below                          | ☐                                                                                                  |

## Phase 3 — Project setup and environment

**Do:** init repo (pinned Node/pnpm, Next.js, strict TS, Tailwind, shadcn), ESLint with boundary/ban rules (`dangerouslySetInnerHTML`, `$queryRawUnsafe`, bare Prisma client outside `lib/db`), Prettier, Vitest, Playwright skeleton, `config/env.ts`, `.env.example`, `.gitignore`, gitleaks pre-commit + CI, CI pipeline (lint, typecheck, test, build, audit), Docker Postgres for local, security headers scaffold, health route.
**Exit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green in CI; secret scan green; env validation fails fast on bad config; no unused dependencies.

## Phase 4 — Authentication and authorization

**Spike first (≤2 days, R-10):** Better Auth with Prisma adapter + custom Argon2id hasher; activation of a provisioned user without a credential row; session revocation on password change/reset; disabling sign-up and unused endpoints; whether IP/UA persistence can be turned off; token storage format.
**Do:** activation, login/logout, reset, change password, session policy, status checks per request, rate limiting (Redis), Turnstile, CSRF/origin layer, `route()` wrapper, `lib/permissions`, role redirects, admin bootstrap CLI, optional admin MFA.
**Exit:** auth + authz tests green: enumeration, session invalidation, reset single-use/expiry, 401/403 correctness, rate limits, cross-origin POST rejected.

## Phase 5 — Database implementation and migrations

**Spike first (R-09):** does `prisma migrate dev/diff` preserve partial indexes, CHECKs, policies and functions applied by raw SQL? Decide the workflow (reviewed SQL migrations + `migrate deploy`; CI assertion listing every expected policy/constraint/function).
**Do:** finalize `schema.prisma`; create roles; apply `001_rls_and_permissions` after fixing/validating it; `withRls`; three Prisma clients; seed (demo only, labelled); RLS test suite as real roles; schema-introspection test that no identity↔answer join path exists.
**Exit:** migrations apply from empty DB; RLS tests green; anonymity introspection test green; concurrency double-submit test green.

## Phase 6 — Student dashboard

Dashboard, course cards, pending/completed lists, deadlines, profile, history (status only), loading/empty/error states. **Exit:** integration + Playwright flows on mobile and desktop; IDOR tests for student routes.

## Phase 7 — Feedback form management (admin)

Catalogue CRUD, enrollments/assignments, roster import (dry-run), form builder, question manager (8 types, 7 categories, reorder, mandatory), eligibility preview/sync, state machine, default question set, audit logging. **Exit:** admin CRUD tests; state-machine tests; all mutations audited.

## Phase 8 — Anonymous feedback submission

Form renderer (RHF + Zod), `submit_feedback` integration, honeypot, thank-you page, error mapping, log hygiene on submit route, accessibility of forms. **Exit:** duplicate/concurrent/expired/tampered-payload tests green; anonymity tests green; Playwright full submission.

## Phase 9 — Instructor dashboard

KPIs, scoped analytics endpoints, comments view, insights (deterministic), release/threshold UX. **Exit:** scoped-access tests; release-rule tests; suppressed-state UI.

## Phase 10 — Admin dashboard

Totals, participation, activity, low-participation alerts, comment moderation, deletion-request handling, audit viewer, settings. **Exit:** admin tests; deletion workflow end-to-end (anonymize function verified).

## Phase 11 — Analytics and comparison

`analytics_aggregate` (cell-level k, scope forcing), all charts, filters, course comparison with normalization and disclosures. **Exit:** filter-driven UI tests; differencing/threshold tests; no hard-coded stats anywhere (grep test).

## Phase 12 — Reporting and exports

CSV/XLSX/PDF generators, authorization on every export, formula-injection neutralization, audit. **Exit:** export tests incl. permission and injection cases; files open in standard viewers.

## Phase 13 — Search, navigation, functional audit

Smart search (trigram, debounced, keyboard, RLS-scoped), navigation by role, clickable logo/metrics/`tel:`/`mailto:`, link/button crawler. **Exit:** crawler reports zero broken links/inert buttons; search security tests.

## Phase 14 — SEO, metadata, accessibility

Titles/descriptions/canonicals/OG, robots/sitemap, noindex on private routes, single H1, FAQ JSON-LD (genuine content only), favicon/icons, contrast fixes per palette note, keyboard/focus audit; CSP-vs-static-rendering decision (R-11). **Exit:** SEO and axe checks green; manual keyboard/screen-reader pass recorded.

## Phase 15 — Privacy, consent, legal pages

Privacy, Terms, Refund (no paid services) pages as reviewable drafts, cookie consent (essential/analytics), consent records, guardian-consent flow, retention settings, analytics wiring behind consent. **Exit:** no analytics before opt-in (tested); consent flows tested; policy text flagged "pending institutional/legal review".

## Phase 16 — Security hardening

Full header/CSP review, dependency audit triage, penetration-style tests (IDOR/XSS/CSRF/SQLi corpora), secrets/history scan, log review, backup/restore drill, DB network and TLS settings, cron route hardening. **Exit:** `security.md §16` suites green; risk register updated with residual risk.

## Phase 17 — Performance optimization

Lighthouse/WebPageTest + RUM on key routes (landing, login, dashboards, form, analytics); bundle budget; dynamic imports for charts/animation; query plans (`EXPLAIN`) for analytics; caching strategy. **Exit:** measured LCP/INP/CLS table; remaining bottlenecks listed honestly.

## Phase 18 — Automated testing

Fill gaps to agreed coverage; contract tests generated from route manifest; Playwright suites per role on 5 viewport bands; visual overflow checks. **Exit:** all suites in CI; flake rate acceptable.

## Phase 19 — Documentation

Final PRD/architecture/security/README/API docs aligned with what exists; testing docs; runbooks (incident, rotation, restore, retention, bootstrap); AGENTS.md updates. **Exit:** docs reviewed against code; no stale claims.

## Phase 20 — Deployment and final verification

Vercel project, managed Postgres, role creation, env/secrets, domain + HTTPS/HSTS, cron, email/Redis/Turnstile/analytics connected **and tested**, smoke tests in production-like environment, final engineering report (PASS/FAIL/PARTIAL/N-A per checklist item with evidence). **Exit:** report delivered; nothing marked PASS without evidence.

## Cross-phase rules

- Definition of done: implemented + tested + documented + security reviewed + lint/type/test/build green.
- Any change to the anonymity design, roles, or RLS requires updating `architecture.md`, `security.md`, `data-inventory.md` and the relevant tests in the same PR.
- Questions in `docs/assumptions-and-decisions.md §4` must be answered by the phase named there (Time zone and minors policy before Phase 4/5; providers before Phase 3/4; retention/k before Phase 15).
