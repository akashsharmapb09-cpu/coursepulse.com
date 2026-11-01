# CoursePulse — Security Architecture

> **Status: Phase 2 design.** Every control below is **DESIGNED**, not implemented and not verified. No checklist item may be marked PASS until it has implementation _and_ test evidence (see §16). This document makes no claim of legal compliance, absolute anonymity or absolute defence against any attack class.

## 1. Purpose and scope

Defines the security and privacy controls for CoursePulse: authentication, authorization, anonymous-feedback protection, API, browser, database, secrets, supply chain and operations. Companion documents: [architecture.md](architecture.md), [docs/api-specification.md](docs/api-specification.md), [docs/data-inventory.md](docs/data-inventory.md), [prisma/sql/001_rls_and_permissions.draft.sql](prisma/sql/001_rls_and_permissions.draft.sql).

## 2. Principles

Least privilege (three DB roles, per-route permissions) · defense in depth (route → object scope → business rule → RLS/privileges) · secure defaults (deny by default, no CORS, no public sign-up) · privacy by design (identity and answers never share a row or a link) · fail securely (errors never reveal existence or internals; DB function failures abort the transaction) · never trust the frontend.

## 3. Threat model and trust boundaries

| Actor                                | Goal                                                   | Primary controls                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Student (malicious)                  | read others' data, submit twice, escalate role, scrape | RLS own-rows only, atomic duplicate guard, no role-write path, rate limits                                                               |
| Instructor (malicious)               | identify a respondent, read other courses              | no access to enrollments/eligibility/submissions tables, release rules (closed + k-threshold), scoped queries                            |
| Admin (curious/insider)              | de-anonymize, tamper, stuff ballots                    | no participation roster, no link in schema, audit log, threshold on admin content views; ballot stuffing only partially mitigated (R-08) |
| External attacker                    | account takeover, injection, enumeration, DoS          | Argon2id, generic errors, Turnstile, distributed rate limits, CSP, parameterized queries, strict validation                              |
| Malicious dependency / leaked secret | RCE / data theft                                       | pinned versions, audit in CI, secret scanning, least-privilege DB roles                                                                  |
| DBA / infra operator                 | correlate identity ↔ answers                           | **out of scope of the anonymity guarantee** (R-01); mitigated by log hygiene, access control, no stored link                             |

Trust boundaries: browser ↔ Next.js (untrusted input), Next.js ↔ PostgreSQL (role-separated), Next.js ↔ third parties (email, Redis, Turnstile, analytics — each receives minimum data).

## 4. Authentication

- **Library:** Better Auth (D-01), credentials only; social/OAuth, magic links and **public self-registration disabled (owner-confirmed; a route-manifest test fails the build if any sign-up path is reachable)**; only an allow-list of its endpoints is exposed (the rest return 404).
- **Provisioned accounts (D-02):** activation by single-use emailed link; link TTL 72 h (activation), 1 h (password reset), 7 d (guardian consent); tokens are single-use and deleted on use or expiry; resending always returns the same public response.
- **Passwords:** Argon2id (start at OWASP minimum m=19 MiB, t=2, p=1; benchmark on the production runtime and raise); min length 12, max 128, no composition rules, no truncation; reject known-breached passwords via a k-anonymity range check (optional third-party call, decision at Phase 4); never log or echo passwords; plaintext never stored.
- **Sessions:** opaque ID in `__Host-` cookie, `HttpOnly; Secure; SameSite=Lax; Path=/`; rotation on login and privilege change; lifetimes ADMIN 8 h absolute, others 7 d sliding (confirm); no IP/User-Agent persisted. Library session tokens may be stored as-is in the `sessions` table (R-05) — mitigated by `cp_auth`-only access, short life and TLS; Phase 4 evaluates hashing them.
- **Revocation:** password change/reset, role change, suspension and deletion delete all the user's sessions; `users.status` is re-checked on every request.
- **Enumeration/timing:** one generic login failure message; the same 202 for forgot-password/resend irrespective of account existence; dummy hash verification on unknown email to equalize timing.
- **Brute force:** per-account+IP and per-IP limits (§10), progressive delays, Turnstile after repeated failures; **no permanent lockout** (it is a DoS lever).
- **Re-authentication:** current password required for password change and deletion requests.
- **Admin:** MFA (TOTP) recommended for v1 (D-23); admin sessions shorter; admin routes never indexed.
- **Bootstrap:** first admin via operator CLI only; no default credentials; the CLI refuses to run if an ADMIN already exists.

## 5. Authorization and IDOR

- Single role per user (D-03); permissions in `lib/permissions` as `role → set<permission>`; each route declares its permission; hidden nav links are UX only.
- **Object-level rule (IDOR by construction):** services resolve resources through actor-scoped queries; an unauthorized ID is indistinguishable from a missing one (404). Student → own enrollments/eligibility; Instructor → own assignments and forms of those assignments; Admin → institution scope.
- **Mass assignment:** Zod `.strict()` schemas per route; role, status, ids of other principals and `eligibleCount` are never accepted from clients (except via dedicated admin endpoints calling DB functions).
- **Role manipulation:** only `app.admin_set_user_role` (INSTRUCTOR↔ADMIN; not self; not last admin; STUDENT immutable); it revokes sessions and audits.
- **Tests (Phase 18):** for every `:id` route, a matrix of actors × foreign IDs asserting 404/403 and zero data in the body.

## 6. Anonymous-feedback controls

Detailed in `architecture.md §8`. Summary of enforceable controls: no user reference in `feedback_submissions/answers/comments`; eligibility has no completion time; comments not linked to submissions; submission only via `app.submit_feedback()` returning `void`; atomic duplicate guard; content released only for CLOSED forms; cell-level k-threshold (default 5, floor 3) in SQL; no instructor date slicing of content; random comment order; admin comment moderation; no per-student pending roster; no user id/body in submit-route logs; analytics never receives answer content or user id; eligibility rows purged after retention. **What is not protected:** raw DB/WAL/log correlation (R-01), tiny cohorts and self-identifying text (R-02), ballot stuffing by a malicious admin (R-08). Product copy must say "your answers are stored separately from your identity and are shown only in aggregate to a minimum group size", never "untraceable".

## 7. Secrets and environment

- `.env*` git-ignored; `.env.example` has placeholders only; `src/config/env.ts` (Zod, loaded from `instrumentation.ts` so a bad configuration fails the boot) validates all variables and reports variable names and rules, never values. Only `NEXT_PUBLIC_*` names on the explicit allow-list in `src/config/env-guards.ts` are accepted (anything else, secret-like or not, aborts boot); a server secret whose value is copied into a public variable aborts boot; in production the guards also reject: the dev rate-limit bypass, any owner/migration database URL in the runtime environment, non-https `SITE_URL`/trusted origins, database URLs without TLS, and identical connection strings for different DB roles. The guards are covered by `tests/security/env-guards.test.ts`.
- Required server secrets (names only): `DATABASE_URL` (cp_app), `DATABASE_URL_AUTH`, `DATABASE_URL_MAINT`, `DATABASE_URL_MIGRATE` (CI/operator only, absent from runtime), `AUTH_SECRET`, `CRON_SECRET`, `EMAIL_API_KEY`, `REDIS_URL/TOKEN`, `TURNSTILE_SECRET`. Public: site URL, Turnstile site key, analytics domain.
- Separate secrets per environment; rotation procedure documented in Phase 20; pre-commit and CI secret scanning (gitleaks or equivalent) including history scan on adoption; any exposed credential is rotated, not merely removed.
- Logs never contain secret values, passwords, tokens, cookies, request bodies or full URLs with tokens (token routes use POST bodies or are scrubbed).

## 8. Data protection and privacy

- Field-by-field justification, access, retention, sensitivity and deletability: [docs/data-inventory.md](docs/data-inventory.md). No IP, user agent, DOB, phone, address, device fingerprint or demographic fields are stored.
- TLS everywhere (HTTPS redirect, HSTS after verification, `sslmode=verify-full` to the database); provider-managed encryption at rest.
- **Retention (defaults to confirm, D-21):** sessions/verifications until expiry; eligibility 180 days after close; audit logs 2 years; feedback answers/comments 5 years; deletion-request records 2 years after completion; consent records 1 year after account deletion (legal to confirm). Enforced by `app.purge_expired()`.
- **Deletion/anonymization:** user → confirm via email + current password → admin review → `app.admin_complete_deletion` removes credentials, sessions, profile, enrollments and eligibility and tombstones the user row. Feedback is unaffected because it never referenced the user. Legal-retention exceptions are written to `resolutionNote`. Backups age out on the provider rotation (R-06).
- **Minors:** `ageGroup` stored as a status, not a DOB; threshold is a setting; guardian consent gate before activation; no age dimension exists in analytics; guardian PII not stored. No legal threshold is assumed (R-16).
- **Cookies:** only essential cookies (session, CSRF, consent choice) by default; analytics loads only after opt-in; consent choice stored in a first-party cookie (D-16).

## 9. Database security and RLS

Roles and grants: `architecture.md §6.1`. Principles: runtime roles are `NOSUPERUSER NOBYPASSRLS`, own nothing; TLS; network allow-list/private networking where the provider supports it; backups enabled; `log_statement=none` and no parameter logging for runtime roles; `pg_stat_statements` disabled or without parameter text.

### Policy matrix (cp_app; "own" = `user_id = app.uid()`)

| Table                                     | Student                          | Instructor       | Admin                     | Notes                                     |
| ----------------------------------------- | -------------------------------- | ---------------- | ------------------------- | ----------------------------------------- |
| users                                     | R own; U name (own)              | R own; U name    | R all                     | role/status/creation only via functions   |
| student_profiles                          | R own                            | —                | R/W all                   |                                           |
| instructor_profiles                       | —                                | R own            | R/W all                   | names via `app.instructor_directory` view |
| departments, courses, academic_semesters  | R                                | R                | R/W                       |                                           |
| course_enrollments                        | R own                            | **—**            | R/W all                   | instructors never see rosters             |
| instructor_course_assignments             | R if enrolled in offering        | R own            | R/W                       |                                           |
| feedback_forms                            | R if eligible                    | R own non-draft  | R/W                       |                                           |
| feedback_questions / options              | R if can view form               | R own non-draft  | R/W only while form DRAFT |                                           |
| feedback_eligibility                      | R own                            | **—**            | **— (counts via fn)**     | no direct writes                          |
| feedback_submissions / answers / comments | **no privilege**                 | **no privilege** | **no privilege**          | access only through `app.*` functions     |
| audit_logs                                | —                                | —                | R; append                 | actor must equal caller; no U/D           |
| consent_records                           | R own; append own (not guardian) | same             | R all; append             | append-only                               |
| data_deletion_requests                    | R own; create; cancel            | same             | R all; review/reject      | completion via function only              |
| app_settings                              | R                                | R                | R/W                       | contains no secrets                       |
| sessions / accounts / verifications       | **no privilege**                 | **no privilege** | **no privilege**          | `cp_auth` only                            |

**Limits:** RLS trusts `app.user_id` set by the app, so a compromised app process defeats it (R-03). Policies depend on helper functions that are `SECURITY DEFINER` (necessary to avoid recursive policy evaluation) — these are part of the audit surface. Prisma does not enforce RLS; every authenticated query must run inside `withRls` (lint rule + integration test that fails if a service uses the bare client). **RLS is tested with the real runtime roles** (list in the SQL file §11).

## 10. API security

- **Validation:** Zod `.strict()` for params, query and body; UUID checks; enum allow-lists; string length caps; request size caps (JSON 100 KB; feedback 64 KB; roster CSV 2 MB, parsed in memory, row cap 5,000); content-type enforcement.
- **Errors:** RFC 9457-style `application/problem+json` with `code` and `requestId`; no stack traces, SQL, table names or library messages; DB errors mapped through an allow-list (`P0001` codes → safe messages). 401 unauthenticated, 403 wrong role, 404 object not visible, 409 duplicate/conflict, 422 validation, 429 rate limit.
- **Injection:** Prisma parameterization; `$queryRaw` only via tagged templates (`Prisma.sql`), never string concatenation (lint rule bans `$queryRawUnsafe`/`$executeRawUnsafe`); search terms escaped for `LIKE` metacharacters.
- **Rate limits** (Redis, keys hashed with a rotating secret, short TTL, no raw IP stored):

| Tier          | Applies to                         | Limit (initial, tune with data)               |
| ------------- | ---------------------------------- | --------------------------------------------- |
| auth-login    | sign-in                            | 5 / 15 min per account+IP; 30 / 15 min per IP |
| auth-recovery | forgot-password, activation resend | 3 / hour per email; 10 / hour per IP          |
| submit        | feedback submission                | 10 / min per user                             |
| search        | search & suggestions               | 30 / min per user                             |
| export        | reports                            | 10 / hour per user                            |
| mutate / read | other writes / reads               | 60 / min and 300 / min per user               |

- **Spam/bots:** Turnstile on login-after-failures, forgot-password and activation; honeypot field on feedback and public forms; duplicate-request suppression via the eligibility guard; suspicious-pattern signals (many 409/422 from one user) logged for review.
- **CORS (D-10):** the API is same-origin only. No `Access-Control-Allow-*` headers are emitted; preflights are rejected; the `Origin` allow-list (site URL + preview URL pattern in non-prod) is used for CSRF, not for enabling cross-origin reads.
- **CSRF (§11):** applies to every non-GET.
- **Internal route:** `/api/internal/maintenance` accepts only `POST` with a bearer `CRON_SECRET` (constant-time compare) and is excluded from sitemap/robots/linking.

## 11. Browser security: XSS, CSRF, headers

- **XSS:** React escapes by default; `dangerouslySetInnerHTML` is lint-banned; user text (comments, names, form titles, question prompts) is plain text — NFC-normalized, control/bidi-override characters stripped, length-capped, rendered as text only; no Markdown/HTML/auto-linking of user content; exports neutralize spreadsheet formulas; nonce-based CSP as a second layer; stored/reflected/DOM XSS test cases in Phase 18.
- **CSRF:** (1) `SameSite=Lax` + `Secure` + `HttpOnly` cookies; (2) every non-GET handler verifies `Origin` (fallback `Referer`) against the allow-list and rejects `Sec-Fetch-Site: cross-site`; (3) a per-session CSRF token header is additionally required for admin mutations, password change, deletion requests and exports; (4) JSON-only content type on mutations; (5) login CSRF covered by the same origin checks. CORS is not treated as CSRF protection.
- **Headers (all routes unless noted):** `Strict-Transport-Security: max-age=63072000; includeSubDomains` (preload only after HTTPS is verified end-to-end); `Content-Security-Policy` — `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'unsafe-inline'` (style-only relaxation, documented trade-off); `img-src 'self' data:; font-src 'self'; connect-src 'self' <analytics-host>; frame-src <turnstile-host>; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`; `Cross-Origin-Opener-Policy: same-origin`; `Cache-Control: no-store` on authenticated pages and API responses; `X-Robots-Tag: noindex, nofollow` on all non-public routes. Nonce CSP forces dynamic rendering of pages that carry it; the performance impact on public pages is an open item (R-11).
- **Debug:** no debug routes, verbose errors or source maps with secrets in production; `NODE_ENV` asserted; DB debug logging off.

## 12. Prompt injection / AI

v1 contains **no LLM or AI feature** (D-14); "insights" are deterministic term counts. Controls therefore: NOT APPLICABLE today. If an AI feature is ever proposed it requires a design review and must at minimum: treat all comments/documents as untrusted data never merged into instructions; send only de-identified, thresholded text; give the model no tools, SQL or code-execution ability; validate structured output with Zod; log security-relevant failures; include indirect-injection tests; and never be described as injection-proof.

## 13. Storage, uploads, webhooks

- **Storage/uploads:** none in v1 (D-12). Roster CSV is parsed in memory and not persisted; reports are streamed, not stored → private buckets/signed URLs are NOT APPLICABLE. If storage is added: private buckets only, short-lived signed URLs, allow-listed MIME + magic-byte checks, size caps, no executable types, download authorization per request.
- **Webhooks:** none in v1 (NOT APPLICABLE). If email-provider webhooks are added: HMAC signature verification with constant-time compare, timestamp tolerance, replay cache/idempotency keys, reject otherwise.

## 14. Supply chain, Git, HTTPS, logging

- **Dependencies:** exact pins + lockfile, minimal set, `pnpm audit` and a second scanner in CI (fail on high/critical), Dependabot/Renovate with review, no postinstall scripts from unknown packages, weekly update cadence.
- **Git:** gitleaks pre-commit + CI + one-off history scan; `.gitignore` covers env files, build output, local DB dumps; branch protection and required CI.
- **HTTPS:** HTTP→HTTPS redirect, Secure cookies, HSTS, no mixed content, TLS to all third parties.
- **Admin audit log (append-only):** user provisioning/status/role changes, session revocations, catalogue edits, form and question changes, activation/closure, eligibility sync, comment moderation, exports, settings changes, deletion-request decisions, report exports by instructors. Metadata is allow-listed per action; **never** passwords, tokens, secrets, request bodies, or anything identifying a submission. Retention 2 years (confirm).
- **Application logs:** structured, request-ID correlated, no PII beyond role; the feedback-submission route logs no user identifier.

## 15. Weaknesses identified before implementation (risk register)

| ID   | Weakness                                                                                                                                                         | Impact                                         | Mitigation / owner phase                                                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | Privileged DB/WAL/log access can correlate identity and answers (commit grouping, row order, infra logs)                                                         | De-anonymization by an insider with raw access | No stored link, no timestamps on identity side, random UUIDs, statement/param logging off, restricted DB access, short log retention; future: anonymous credentials. Accepted and disclosed (P8, P16) |
| R-02 | Small cohorts; self-identifying comments ("the only exchange student…")                                                                                          | Re-identification                              | k-threshold (≥3, default 5), comment moderation, random order, suppression; guidance text to students (P8, P10)                                                                                       |
| R-03 | Compromised app process can set `app.user_id`                                                                                                                    | RLS bypassed                                   | Treat RLS as defense-in-depth; least-privilege roles limit blast radius (anonymous tables unreadable by `cp_app`); secrets hygiene (P5, P16)                                                          |
| R-04 | Differencing via overlapping filters/dates                                                                                                                       | Individual ratings inferred                    | Release after close; cell-level k; no instructor date slicing; query-rate limits; admin content date filters audited (P11)                                                                            |
| R-05 | Library may store session/verification tokens unhashed                                                                                                           | DB read ⇒ session/token theft                  | Only `cp_auth` can read; short TTL; single-use; evaluate hashing hook (P4)                                                                                                                            |
| R-06 | Backups retain deleted data and keep identity+answers together                                                                                                   | Deletion not instantaneous; backup compromise  | Document rotation window; encrypt backups; restrict restore access; retention in privacy policy (P15, P20)                                                                                            |
| R-07 | Side channels: live participation counts, submit-route logs, auth response timing                                                                                | Weak correlation of one student's activity     | Hourly count granularity for instructors, no user id in submit logs, timing equalization (P8, P11)                                                                                                    |
| R-08 | Malicious admin can provision fake students/enrollments (ballot stuffing) or narrow a cohort                                                                     | Integrity of results                           | Audit log, roster-import dry-run + diff, k-threshold, second-admin review recommended; not fully preventable                                                                                          |
| R-09 | Prisma Migrate may try to drop raw-SQL objects (partial indexes, CHECKs, functions, policies) it does not model                                                  | Silent loss of controls                        | Phase 5 spike; migrate via reviewed SQL files; CI test that asserts every policy/constraint exists after `migrate deploy`                                                                             |
| R-10 | Better Auth behaviours unverified: custom Argon2id hasher, activation of an account with no credential row, session/revoke options, schema mapping, IP/UA fields | Design assumptions may need change             | Phase 4 spike before building flows; fall back to Auth.js-compatible custom flow only if needed                                                                                                       |
| R-11 | Nonce-based CSP forces dynamic rendering, conflicting with the LCP target on public pages                                                                        | Performance vs security                        | Measure in P14/P17; options: static public shell with hashed script policy, PPR                                                                                                                       |
| R-12 | Third-party scripts (Turnstile, analytics) on public pages                                                                                                       | Privacy/CSP/availability                       | Load Turnstile only on forms that need it; analytics only post-consent; document in privacy policy                                                                                                    |
| R-13 | Institutional mailbox is the trust anchor for activation/reset                                                                                                   | Mailbox compromise ⇒ account takeover          | Short TTLs, single-use links, admin MFA, session revocation, notify on password change                                                                                                                |
| R-14 | Roster CSV import abuse (formula injection, oversize, duplicates, encoding tricks)                                                                               | Data integrity / DoS                           | Size/row caps, strict column schema, dry-run, UTF-8 only, transactional apply                                                                                                                         |
| R-15 | If Supabase is used, its Data API could expose tables                                                                                                            | Direct unauthenticated-style access path       | Disable Data API for app schemas; no grants to `anon`/`authenticated`                                                                                                                                 |
| R-16 | Legal requirements for minors, retention and consent are jurisdiction/institution-specific and unverified                                                        | Non-compliance                                 | Settings-driven thresholds; institution/legal review before launch                                                                                                                                    |
| R-17 | Comments may contain abuse or third-party personal data                                                                                                          | Harm; retention of unwanted data               | Moderation tool, hide-by-default option, purge schedule                                                                                                                                               |
| R-18 | Wrong section/co-teaching configuration makes students eligible for the wrong form                                                                               | Corrupt results                                | Section column (D-20), eligibility preview before activation, admin audit                                                                                                                             |

## 16. Controls status and test plan

All controls: **DESIGNED**. Evidence required before PASS: automated test in `tests/security/**` or a recorded manual check, plus implementation reference. Planned suites: `auth` (enumeration, lockout/limits, session invalidation, reset single-use/expiry), `authz` (role matrix, IDOR matrix), `rls` (SQL §11 list, run as real roles), `anonymity` (no join path exists: schema introspection test fails the build if any FK/column links identity and anonymous tables; threshold/release-rule tests; concurrency double-submit), `csrf` (cross-origin POST rejected for every mutating route — enumerated from the route manifest), `xss` (payload corpus through every text field), `injection` (SQLi corpus through search/filters), `headers/cors`, `rate-limit`, `exports` (formula injection, authorization), `secrets` (gitleaks in CI), `deps` (audit in CI).

## 17. Incident reporting

Provide `/.well-known/security.txt` (contact supplied by the institution — not invented). Internal runbook (Phase 19/20): triage → contain (revoke sessions, rotate secrets, disable routes) → assess data exposure (anonymous tables vs identity tables) → notify per institutional and legal obligations → post-mortem. Breach-notification duties are jurisdiction-specific and are for the institution's counsel to define.

## 18. Recommendations

1. Run the Better Auth and Prisma-plus-raw-SQL spikes (R-09, R-10) before committing to Phase 4/5 details.
2. Institution to confirm: `k`, retention periods, minor threshold and consent route, time zone, email provider, and whether sections exist.
3. Commission a lightweight external review of the RLS/function layer and a penetration test before go-live.
4. Treat admin MFA and a two-person rule for roster imports as launch requirements if the institution is risk-averse.
5. Decide whether the stronger (anonymous-credential) submission design is warranted for the institution's threat model.
