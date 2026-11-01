# AGENTS.md — Instructions for coding agents working on CoursePulse

CoursePulse is a privacy-first course feedback portal for a university. Student anonymity and access control are the product's core promise. Read this file fully before changing anything.

## 1. Before you start (every task)

1. Inspect the current repository state: `git status`, the files you will touch, `package.json`/lockfile, existing tests.
2. Read the relevant docs: `PRD.md` (what), `architecture.md` (how), `security.md` (constraints), `docs/api-specification.md` (contracts), `docs/data-inventory.md` (what data may exist), `docs/assumptions-and-decisions.md` (decisions D-xx), `plan.md` (current phase), `codestyle.md`.
3. Identify the current phase in `plan.md`. Do not start work from a later phase, and do not start Phase 3 or later until the owner has approved the Phase 2 design.
4. If a requirement conflicts with a decision or with `security.md`, stop and ask; do not silently pick one.

## 2. General rules

- Preserve working functionality; make the smallest change that solves the problem; no unnecessary rewrites or dependencies (justify any new package: need, maintenance, size, licence, `pnpm audit` result).
- Follow `codestyle.md`. Match existing patterns before inventing new ones.
- Never report something as done unless it is implemented **and** verified by a test or a recorded manual check. Never fabricate results, metrics, test output, contact details, testimonials or statistics.
- Do not add personal-data fields "just in case". Any new column requires an entry in `docs/data-inventory.md` (why, who can access, retention, sensitivity, deletability) before it lands.
- Keep documentation consistent: a change to behaviour, roles, API, schema or security updates the affected docs in the same change.

## 3. Code guidelines

Strict TypeScript, no `any`; Zod `.strict()` validation for every external input (client and server); services are the only layer that authorizes and touches the database; reusable components; consistent error handling via the central problem+json mapping; loading/empty/error/success states for async UI; accessibility and responsive behaviour are part of every UI change.

## 4. Non-negotiable security and privacy rules

1. **Anonymity invariants** — never add a column, relation, index, log line, analytics event, cache key, export field or API field that links a student (or any user) to a `feedback_submissions` / `feedback_answers` / `feedback_comments` row, to a submission id, or to a completion time. Never give `feedback_eligibility` a completion timestamp or `updatedAt`. Never link comments to submissions. Never return a submission id from the database or API. The `anonymity` test suite must stay green; if it fails, your change is wrong.
2. **Release rules** — analytics/comments content is released only for CLOSED forms and only when the cell has ≥ `min_responses` distinct submissions. Do not add endpoints, exports or filters that bypass this.
3. **Authorize every protected operation on the server** — never trust the frontend or hidden links. Role check in `route()`, object-level scoping in the query, business rules in policies, RLS beneath.
4. **No IDOR** — never `findUnique({ where: { id } })` on a user-addressed resource; use scope helpers; unauthorized ids return 404.
5. **Database access** — authenticated queries run inside `withRls`; no `$queryRawUnsafe`/`$executeRawUnsafe`; parameterized SQL only; never connect with the owner role at runtime; never use `cp_auth`/`cp_maint` clients outside their modules.
6. **Privilege-changing writes** (create user, role/status change, session revocation, deletion completion, eligibility sync, moderation) go through the `app.*` functions and are audited — do not re-implement them in application code.
7. **Secrets** — never commit secrets; never expose server values via `NEXT_PUBLIC_*`; update `.env.example` (placeholders only) when adding variables; never log secrets, tokens, passwords, cookies, request bodies or full token URLs.
8. **XSS/CSRF** — user text is plain text; no `dangerouslySetInnerHTML`; every non-GET goes through the origin check; high-risk routes require the CSRF token.
9. **Enumeration and timing** — auth and recovery responses must be uniform.
10. **No fake security** — do not claim "anonymous" beyond what `architecture.md §8` supports, do not claim compliance, do not describe a defence as perfect.
11. **No AI features** or LLM calls without an approved design review (`security.md §12`).
12. **Admin protection** — no default credentials, no demo admin routes, no public admin endpoints.

## 5. Working method

Plan → implement in small steps → write/adjust tests → run checks → review diff for security-sensitive changes. For schema/RLS changes also run the RLS and anonymity suites against a real Postgres. For UI changes check 320 px, 768 px and ≥1280 px for horizontal overflow, keyboard focus and contrast.

## 6. Definition of done (run all; paste real results in the PR)

```
pnpm lint && pnpm typecheck && pnpm test && pnpm test:security && pnpm build
```

Plus: relevant Playwright flows, `pnpm audit` (no unresolved high/critical), secret scan clean, docs updated, security review checklist completed for changes touching auth, RLS, anonymity, exports, settings or search.

## 7. When unsure

Ask. Record new decisions in `docs/assumptions-and-decisions.md` (next D-id) and new risks in `security.md §15` (next R-id).
