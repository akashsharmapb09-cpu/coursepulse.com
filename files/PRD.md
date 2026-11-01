# CoursePulse — Product Requirements Document

> **Status: Phase 2 design v0.1 — pending owner review.** Product name: **CoursePulse** (Smart Course Feedback & Analytics Portal). Priorities: **M** = must (v1 launch), **S** = should (v1 if time, else v1.1), **C** = could (later). Decision IDs (D-xx) and risks (R-xx) refer to `docs/assumptions-and-decisions.md` and `security.md`.

## 1. Vision and problem

**Vision:** turn student feedback into better learning experiences by giving institutions a trustworthy, privacy-first way to collect anonymous course feedback and understand teaching and course quality.

**Problem:** feedback is scattered, evaluated inconsistently, hard to compare across courses/instructors/semesters, reported manually, weakly protected, and not centralized.

## 2. Objectives and success metrics

| Objective                                | Metric (measured after launch, targets set with the institution)                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Collect structured feedback consistently | share of courses using a standard form; question coverage of `comparisonKey` set                                                       |
| Increase participation                   | participation rate per form (target set by institution; baseline from first term)                                                      |
| Protect student privacy                  | zero schema paths linking identity to answers (automated test); zero privacy incidents; k-threshold enforced on 100% of released cells |
| Useful insights                          | instructor dashboard weekly use; reports exported; improvement areas viewed                                                            |
| Reliable and fast                        | LCP ≤ 2 s, INP ≤ 200 ms, CLS ≤ 0.1 on measured key routes (measured, not assumed)                                                      |
| Accessible                               | WCAG 2.2 AA audit with no critical failures                                                                                            |

## 3. Personas

- **Student (Asha, 19):** wants to give honest feedback quickly, needs confidence that teachers cannot see who wrote what, uses a phone.
- **Instructor (Dr. Rao):** wants fair, aggregated, actionable results; must not be able to identify respondents; compares semesters.
- **Administrator (Registrar/Quality office):** sets up terms, courses, forms and deadlines; monitors participation; compares departments; handles privacy requests; must be accountable (audit).

(Persona names are illustrative labels for design discussion, not real people.)

## 4. Functional requirements

### 4.1 Authentication and accounts

| ID         | Requirement                                                                                                                                                           | Pri                              | Acceptance criteria                                                                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-AUTH-01 | Admin creates or invites students and instructors (single or CSV roster with dry-run) and manages activation: send / resend / revoke invitation, suspend / reactivate | M                                | Invited user gets activation email; revoked or expired invitation cannot be used; CSV dry-run shows diff; apply is atomic; every action audited; admin cannot activate an account without the user proving mailbox control |
| FR-AUTH-10 | Public self-registration is disabled (D-02, owner-confirmed)                                                                                                          | M                                | No sign-up page or endpoint exists (direct calls return 404); the public site offers "Log in" and "Activate your account" only; automated test fails the build if a sign-up route is reachable                             |
| FR-AUTH-02 | Account activation via single-use expiring link; sets password                                                                                                        | M                                | Link works once; expired/used link shows safe error; minors continue to guardian-consent gate                                                                                                                              |
| FR-AUTH-03 | Login / logout with generic failure message                                                                                                                           | M                                | Same message for unknown email, wrong password, non-active account; rate-limited                                                                                                                                           |
| FR-AUTH-04 | Forgot/reset password with non-enumerating response                                                                                                                   | M                                | Same 202 and similar timing whether or not account exists; link single-use, 1 h                                                                                                                                            |
| FR-AUTH-05 | Change password (current password required)                                                                                                                           | M                                | All other sessions revoked; email notification sent                                                                                                                                                                        |
| FR-AUTH-06 | Session expiry, secure cookies, role-based redirect, protected routes                                                                                                 | M                                | Role lands on own dashboard; other roles' routes → 403/redirect; expired session → login                                                                                                                                   |
| FR-AUTH-07 | Suspension and session revocation                                                                                                                                     | M                                | Suspended user rejected on next request; sessions deleted                                                                                                                                                                  |
| FR-AUTH-08 | Admin MFA (TOTP)                                                                                                                                                      | S                                | Admin login requires second factor when enabled (D-23)                                                                                                                                                                     |
| FR-AUTH-09 | Guardian consent for minors                                                                                                                                           | M (if institution admits minors) | Account stays `PENDING_GUARDIAN_CONSENT` until consent record exists; no guardian PII stored                                                                                                                               |

### 4.2 Student

| ID        | Requirement                                                                                              | Pri | Acceptance criteria                                                                                                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-STU-01 | Dashboard: welcome, enrolled count, pending, completed, progress, course cards, deadlines, quick actions | M   | Numbers from DB; course card shows name, code, instructor, department, status, deadline, Submit button                                                                                                                                     |
| FR-STU-02 | View pending feedback forms                                                                              | M   | Only eligible, ACTIVE, pre-deadline forms                                                                                                                                                                                                  |
| FR-STU-03 | Submit anonymous feedback (all question types, optional comments)                                        | M   | Required enforced client+server; single-choice shows radio buttons (one answer), multiple-choice and multiple-selection show checkboxes (selection cap enforced); one submission per form; confirmation page shows course/form/status only |
| FR-STU-04 | Duplicate prevention                                                                                     | M   | Second submit (sequential or concurrent) → 409; exactly one submission exists                                                                                                                                                              |
| FR-STU-05 | Submission history (status only)                                                                         | M   | Lists form/course/semester/status; no answers (D-08)                                                                                                                                                                                       |
| FR-STU-06 | Profile: update name; view studentNumber/ageGroup                                                        | M   | Only `name` writable                                                                                                                                                                                                                       |
| FR-STU-07 | Deletion request: submit, confirm by email, track status                                                 | M   | Needs current password; one open request; status visible                                                                                                                                                                                   |

### 4.3 Instructor

| ID        | Requirement                                                                                                        | Pri | Acceptance criteria                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------ | --- | -------------------------------------------------------------------------- |
| FR-INS-01 | View assigned courses/offerings                                                                                    | M   | Only own assignments (foreign id → 404)                                    |
| FR-INS-02 | Dashboard KPIs: assigned courses, responses, average rating, participation                                         | M   | Content only from released forms; participation counts hourly-refreshed    |
| FR-INS-03 | Visualizations: course ratings, rating distribution, semester trends, teaching effectiveness, category performance | M   | Real data; filters change all charts/KPIs; suppression state when n<k      |
| FR-INS-04 | Read anonymized comments                                                                                           | M   | After close and ≥k; random order; no dates; hidden comments excluded       |
| FR-INS-05 | Insights: strengths, improvement areas, frequent topics                                                            | S   | Derived deterministically; shown only above threshold                      |
| FR-INS-06 | Historical comparison and course comparison                                                                        | M   | Only own offerings; shows `n`; excludes incompatible questions with notice |
| FR-INS-07 | Export reports (PDF/CSV/Excel) for assigned offerings                                                              | M   | Authorization checked on download; same release rules; audit-logged        |
| FR-INS-08 | Cannot identify individuals                                                                                        | M   | Automated schema test: no join path; no roster/eligibility access          |

### 4.4 Administrator

| ID        | Requirement                                                                                                                                                                                                                           | Pri | Acceptance criteria                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-ADM-01 | Manage users: create/invite, invitation lifecycle, roles (INSTRUCTOR↔ADMIN), suspension, session revocation                                                                                                                           | M   | Cannot change self; cannot remove last admin; invitation status visible (pending / accepted / revoked / expired); audited                                              |
| FR-ADM-02 | Manage departments, courses, semesters, enrollments, instructor assignments                                                                                                                                                           | M   | Delete blocked when referenced (deactivate instead)                                                                                                                    |
| FR-ADM-03 | Form builder: create/edit/delete, activate/deactivate (close/archive), assign to offering, deadline                                                                                                                                   | M   | State machine DRAFT→ACTIVE→CLOSED→ARCHIVED; edit locked after activation                                                                                               |
| FR-ADM-04 | Question manager: 8 types, 7 categories, mandatory flag, reorder. Choice semantics (D-18): **single-choice = exactly one answer; multiple-choice = one or more answers; multiple-selection = one or more up to a configured maximum** | M   | Type/scale/option validation; single-choice rejects >1 answer; multiple-choice accepts several; multiple-selection rejects more than `maxSelections`; reorder persists |
| FR-ADM-05 | Eligibility preview and sync                                                                                                                                                                                                          | M   | Shows count (not names) per offering; idempotent                                                                                                                       |
| FR-ADM-06 | Institution dashboard: totals, participation, average rating, recent activity, collection status, department/course/semester comparisons, low-participation alerts                                                                    | M   | Counts live; content only from released forms                                                                                                                          |
| FR-ADM-07 | Reports (PDF/CSV/Excel)                                                                                                                                                                                                               | M   | Admin scope; audit-logged                                                                                                                                              |
| FR-ADM-08 | Comment moderation (hide/unhide with reason)                                                                                                                                                                                          | M   | Audited; instructors never see hidden comments                                                                                                                         |
| FR-ADM-09 | Deletion-request handling                                                                                                                                                                                                             | M   | Review → complete (anonymize) or reject with note; retention exceptions recorded                                                                                       |
| FR-ADM-10 | Settings (k, time zone, thresholds, retention)                                                                                                                                                                                        | M   | Allow-listed keys with validated ranges; audited                                                                                                                       |
| FR-ADM-11 | Audit log viewer with filters                                                                                                                                                                                                         | M   | Read-only; no secrets/PII in metadata                                                                                                                                  |

### 4.5 Analytics, comparison, reporting

| ID        | Requirement                                                                                                                        | Pri | Acceptance criteria                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------- |
| FR-ANA-01 | Charts: course bar, semester line, distribution donut, category radar, department comparison, sentiment buckets, response timeline | M   | Backed by SQL aggregates; no hard-coded sample stats      |
| FR-ANA-02 | Filters: year, semester, course, department, instructor, date range, category                                                      | M   | All charts/KPIs update; role restrictions per API spec §7 |
| FR-ANA-03 | Course comparison side-by-side cards + interactive charts                                                                          | M   | Compatible questions only; response counts disclosed      |
| FR-ANA-04 | Report contents: course, instructor, semester, response count, ratings, categories, trends, anonymized comments, date              | M   | Present in all three formats; formula-injection safe      |
| FR-ANA-05 | Release rules: closed form + k-threshold at cell level                                                                             | M   | Unit + integration tests incl. differencing cases         |

### 4.6 Search, navigation, public site

| ID         | Requirement                                                                                                                                   | Pri | Acceptance criteria                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------ |
| FR-SRCH-01 | Permission-aware smart search over courses, codes, departments, instructors, forms, reports                                                   | M   | Debounce, suggestions, loading/empty states, keyboard nav, clear, mobile layout, highlight; never comments; rate-limited |
| FR-NAV-01  | Role-specific navigation; clickable logo to role home; no dead links/buttons; no `href="#"`                                                   | M   | Playwright link/button crawl passes                                                                                      |
| FR-NAV-02  | Clickable metrics only where a filtered view exists                                                                                           | M   | e.g. total courses → course management                                                                                   |
| FR-NAV-03  | `tel:` / `mailto:` links for institution-supplied contacts                                                                                    | M   | Rendered only when configured; never invented                                                                            |
| FR-PUB-01  | Landing page with specified headline, description, CTAs ("Get Started", "Explore Features")                                                   | M   | Text exact; one H1                                                                                                       |
| FR-PUB-02  | Public pages: About, Features, Contact, Support (with genuine FAQ), Privacy, Terms, Refund Policy (states no paid services), custom 404/error | M   | Unique titles/descriptions/canonicals                                                                                    |
| FR-PUB-03  | Functional footer; sticky CTA on public pages only                                                                                            | M   | All links valid                                                                                                          |
| FR-PUB-04  | Cookie consent: essential / optional analytics, accept/reject/preferences                                                                     | M   | No analytics before opt-in; choice respected                                                                             |
| FR-PUB-05  | Analytics events (page view, activation, form start/complete, dashboard, search, export)                                                      | S   | Events verified received; no PII/text; consent-gated                                                                     |

## 5. Non-functional requirements

| ID             | Category        | Requirement                                                                                                                                                           |
| -------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-SEC-01     | Security        | All controls in `security.md`; every item evidenced by a test before being reported PASS                                                                              |
| NFR-PRIV-01    | Privacy         | Data minimization per `docs/data-inventory.md`; anonymity design per `architecture.md §8`; no cryptographic-anonymity claims                                          |
| NFR-PERF-01    | Performance     | LCP ≤ 2 s (mobile profile where feasible), INP ≤ 200 ms, CLS ≤ 0.1; reported from Lighthouse/RUM measurements; API p95 targets set after baseline                     |
| NFR-A11Y-01    | Accessibility   | WCAG 2.2 AA: contrast, focus visible, keyboard operability, labels, error announcements (aria-live), no colour-only meaning, reduced-motion respected                 |
| NFR-RESP-01    | Responsive      | Works 320 px → ≥1441 px; no unintended horizontal scroll; touch targets ≥ 44 px; wide tables/charts scroll inside their own container                                 |
| NFR-SEO-01     | SEO             | Unique title/description, canonical, OG, one H1, sitemap/robots, favicon; private routes `noindex`; FAQ JSON-LD only for visible FAQ content; no rich-result promises |
| NFR-REL-01     | Reliability     | Transactional submission; idempotent jobs; backups with tested restore; graceful error pages                                                                          |
| NFR-MAINT-01   | Maintainability | Strict TypeScript, module boundaries enforced by lint, ≥ agreed coverage on services and security tests                                                               |
| NFR-SCALE-01   | Scalability     | Stateless app tier; indexed queries; pagination everywhere; cacheable closed-form aggregates                                                                          |
| NFR-UX-01      | Ethical UX      | No dark patterns: no pre-ticked consent, no deceptive urgency, deletion as easy as sign-up, honest success/failure messages                                           |
| NFR-LEGAL-01   | Legal           | Policy pages drafted as templates for review by the institution/counsel; no compliance claims                                                                         |
| NFR-CONTENT-01 | Content         | No fake testimonials, statistics, partners, contact data or "AI" claims; demo data labelled and absent from production                                                |

Palette (from brief): background `#F8FAFC`, primary `#1E3A8A`, secondary `#2563EB`, success `#16A34A`, warning `#F59E0B`, danger `#DC2626`, text `#0F172A`, muted `#64748B`, card `#FFFFFF`, border `#E2E8F0`. Contrast, computed (Phase 3): text `#0F172A`, muted `#64748B` (4.55:1 on the background, 4.76:1 on cards), primary, secondary and danger all pass AA for text. **Success `#16A34A` (3.30:1) and warning `#F59E0B` (2.15:1) fail as small text or under white text**, and the `#E2E8F0` border (1.23:1) is decorative only. Therefore success/warning are used for fills, icons and charts; text uses `#15803D` / `#B45309` (5.02:1); form-control borders use `#64748B`; muted body text uses `#475569` (7.24:1). Enforced by `tests/unit/contrast.test.ts`.

## 6. User journeys (summary)

1. **Student:** receives activation email → sets password → dashboard → opens pending course form → answers (required items validated) → submits → thank-you page → history shows "Submitted".
2. **Admin:** imports roster (dry-run → apply) → sets semester → creates courses/assignments/enrollments → builds form → previews eligibility count → activates with deadline → monitors participation counts → form closes at deadline → views released analytics → exports report → handles a deletion request.
3. **Instructor:** logs in → sees offerings and participation counts → after closure views ratings, trends, comments → compares semesters → exports report.
4. **Privacy request:** student requests deletion → confirms by email → admin reviews → completes anonymization → student receives confirmation.

## 7. User stories (selection)

As a student I want to submit feedback without my name attached so that I can be honest. · As a student I want to see which forms are pending so that I don't miss deadlines. · As an instructor I want category-level results so that I know what to improve. · As an instructor I want to be unable to see who responded so that the process is fair. · As an admin I want to assign a form to an offering with a deadline so that collection is consistent. · As an admin I want an audit trail of administrative actions so that changes are accountable. · As a student I want to request deletion of my account data so that I control my personal data.

## 8. Scope

**In scope (v1):** everything marked M/S above. **Out of scope (v1):** open self-registration, SSO, payments, file uploads, AI features, mobile native apps, multi-institution tenancy, real-time/live results during collection, automated reminder emails (S/C later).

## 9. Security and privacy requirements

Authoritative in `security.md` and `docs/data-inventory.md`. Non-negotiables: no identity↔answer link, no plaintext secrets/passwords, server-side authorization on every route, RLS + least-privilege DB roles, release rules and k-threshold, minimal data, deletion workflow, audit logs, no unverified claims.

## 10. Dependencies and risks

External inputs required from the institution: roster and assignments, policy text review, contact details, time zone, minor policy, domain, provider accounts (database, email, Redis, analytics, Turnstile). Key risks: R-01 … R-18 in `security.md §15`; delivery risk: Better Auth and Prisma-plus-raw-SQL spikes (Phases 4–5).
