# CoursePulse — Data Inventory (data minimization record)

> **Status: design v0.1.** Retention values are **defaults proposed for the institution to confirm** (D-21); they are not legal advice. "Sensitive" means: personal data whose exposure would plausibly harm a person, or data that would weaken anonymity.
> Abbreviations — **Self**: the data subject; **Admin**: ADMIN role through the app; **Instr**: INSTRUCTOR of the assigned offering; **DB-fn**: only inside `SECURITY DEFINER` functions (no direct role access); **Auth**: `cp_auth` role only.

## Explicitly NOT collected

IP addresses (except transient hashed rate-limit keys in Redis with short TTL), user agents/device fingerprints, date of birth, phone numbers, postal addresses, gender/ethnicity/religion or any demographic attribute, location, profile photos, government IDs, payment data, guardian names/emails (beyond an expiring verification row), OAuth tokens, feedback text in analytics events.

## users

| Field                 | Why required                           | Access                                                    | Retention                                            | Sensitive | Deletable               |
| --------------------- | -------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------- | --------- | ----------------------- |
| id                    | Primary key                            | all (own)                                                 | life of tombstone                                    | no        | tombstoned, not removed |
| name                  | Display in UI and instructor directory | Self, Admin; instructor name visible to enrolled students | until anonymization → "Deleted user"                 | personal  | yes (anonymized)        |
| email                 | Login, activation/reset mail           | Self, Admin, Auth                                         | until anonymization → `deleted-<id>@deleted.invalid` | personal  | yes (anonymized)        |
| emailVerified         | Gate activation                        | Self, Admin, Auth                                         | with user                                            | no        | with user               |
| role                  | Authorization                          | Admin; derived server-side                                | with user                                            | no        | no (needed by audit)    |
| status                | Account lifecycle, suspension          | Admin, server                                             | with user                                            | no        | no                      |
| createdAt / updatedAt | Support, lifecycle                     | Admin                                                     | with user                                            | no        | with user               |

## student_profiles

| Field                 | Why                                                         | Access      | Retention      | Sensitive                 | Deletable         |
| --------------------- | ----------------------------------------------------------- | ----------- | -------------- | ------------------------- | ----------------- |
| userId                | 1:1 link                                                    | Self, Admin | until deletion | no                        | yes (row deleted) |
| studentNumber         | Match roster to account; prevent duplicates                 | Self, Admin | until deletion | personal identifier       | yes               |
| ageGroup              | Gate guardian-consent flow for minors (status only, no DOB) | Self, Admin | until deletion | moderately (child status) | yes               |
| createdAt / updatedAt | lifecycle                                                   | Admin       | until deletion | no                        | yes               |

## instructor_profiles

| Field                | Why                                                  | Access                                                                  | Retention                                                                                                                      | Sensitive | Deletable     |
| -------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------- |
| userId, departmentId | Scope analytics by department; department comparison | Self, Admin; directory view (name + department) for authenticated users | kept after anonymization so historical analytics stay attributable to a "former instructor" (admin may delete if unreferenced) | no        | conditionally |
| createdAt            | lifecycle                                            | Admin                                                                   | with row                                                                                                                       | no        | with row      |

## departments / courses / academic_semesters

Institutional catalogue data (code, name/title, activity flag, dates, academic year, term number, current flag): needed for navigation, search and analytics grouping; readable by authenticated users, writable by Admin; retained as long as referenced by history; no personal data; deletable only when unreferenced (else deactivate).

## course_enrollments

| Field                                    | Why                                                  | Access                           | Retention                                                        | Sensitive                   | Deletable |
| ---------------------------------------- | ---------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------- | --------------------------- | --------- |
| studentId, courseId, semesterId, section | Determine which students may evaluate which offering | Self (own), Admin; **not** Instr | deleted with student; otherwise per institutional records policy | personal (education record) | yes       |
| status, createdAt                        | withdrawn students are not eligible                  | Self, Admin                      | same                                                             | personal                    | yes       |

## instructor_course_assignments

instructorId, courseId, semesterId, section, createdAt: who teaches what; needed to attach forms and scope instructor access. Access: Instr (own), enrolled students (offering only), Admin. Retained with historical analytics. Personal data: low (professional role).

## feedback_forms / feedback_questions / feedback_options

Form and question content (title, description, status, opens/closes, eligibleCount snapshot, question category/type/prompt/required/position/scale/maxSelections/comparisonKey, option label/position). Why: configure and render surveys; `eligibleCount` allows participation rates after eligibility rows are purged; `comparisonKey` enables like-for-like comparison. Access: Admin (write while DRAFT), eligible students (active form), assigned Instr (non-draft). Retention: kept with feedback (default 5 years after close). No personal data (prompts must not contain personal data — validated length/text rules). Deletable: DRAFT forms only; others archived.

## feedback_eligibility (identity side)

| Field                      | Why                                                | Access                                                 | Retention                                                                     | Sensitive                        | Deletable                |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------- | ------------------------ |
| studentId + formId         | Decide who may submit; duplicate guard             | Self (own rows) only; Admin/Instr get counts via DB-fn | **180 days after form deadline**, or immediately with the student on deletion | **high** (participation mapping) | yes (purge job, cascade) |
| status (PENDING/SUBMITTED) | Duplicate guard; student's pending/completed lists | Self                                                   | same                                                                          | high                             | yes                      |
| createdAt                  | When eligibility was granted (not when completed)  | none directly (DB)                                     | same                                                                          | low                              | yes                      |
| _completion time_          | **intentionally absent**                           | —                                                      | —                                                                             | —                                | —                        |

## feedback_submissions / feedback_answers / feedback_comments (anonymous side)

| Field                                               | Why                                                       | Access                                                          | Retention                                                        | Sensitive                                                       | Deletable               |
| --------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------- |
| submission.id (random UUID), formId                 | Group one respondent's answers for completeness/analytics | DB-fn only                                                      | default 5 years after form close                                 | anonymized; pseudo-identifying only in tiny cohorts             | purge job (by form age) |
| submission.submittedOn (DATE)                       | Response timelines                                        | DB-fn → counts per day/week                                     | same                                                             | low                                                             | same                    |
| answer.questionId/optionId/ratingValue/booleanValue | The evaluation data                                       | DB-fn → thresholded aggregates (Admin, assigned Instr)          | same                                                             | anonymized                                                      | same                    |
| comment.formId/questionId/body/status               | Qualitative feedback; moderation                          | DB-fn → released only after close + threshold; Admin moderation | same (comments may be purged earlier if the institution prefers) | **may contain personal data or identifying detail** (free text) | purge; admin hide       |
| _user reference, timestamps (comment), IP, UA_      | **intentionally absent**                                  | —                                                               | —                                                                | —                                                               | —                       |

## audit_logs

actorId, actorRole, action, resourceType, resourceId, metadata (allow-listed), createdAt. Why: accountability for administrative and export actions. Access: Admin read-only; append-only for the app. Retention default 2 years. Sensitive: contains user ids of staff/targets; metadata must never include passwords, tokens, bodies, comment text or submission identifiers. Deletable only by retention job.

## consent_records

userId, type, policyVersion, status, method, createdAt. Why: evidence of terms/privacy acknowledgement and of guardian consent for minors (no guardian identity stored). Access: Self, Admin. Retention: life of account + 1 year after anonymization (**legal to confirm**; retention exception recorded in the deletion request). Sensitive: moderate (relates to child status). Deletable after retention.

## data_deletion_requests

userId, status, reason (optional, ≤500), resolutionNote (retention exceptions/rejection reason), createdAt, updatedAt, completedAt. Why: workflow and proof that a deletion was handled. Access: Self (own), Admin. Retention: 2 years after completion (confirm). Sensitive: reason is free text — warn the user not to include sensitive details. Deletable after retention.

## sessions / accounts / verifications (authentication)

| Table.field                                   | Why                                                                                               | Access    | Retention                    | Sensitive                    | Deletable               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------- | ---------------------------- | ---------------------------- | ----------------------- |
| sessions.token, expiresAt, userId, timestamps | Authenticated sessions (no IP/UA stored)                                                          | Auth only | until expiry/revocation      | high (credential-equivalent) | yes (revocation, purge) |
| accounts.password                             | Argon2id hash for login                                                                           | Auth only | until deletion/anonymization | high                         | yes                     |
| accounts.providerId/accountId                 | credential account key                                                                            | Auth only | with user                    | low                          | yes                     |
| verifications.identifier/value/expiresAt      | Activation, reset, deletion-confirm, guardian-consent tokens (guardian email only here, expiring) | Auth only | ≤ 7 days, deleted on use     | high                         | yes                     |

## app_settings

Key/value settings (thresholds, time zone, retention). No secrets, no personal data. Access: authenticated read, Admin write. Retained indefinitely. Not sensitive.

## Operational data outside the database

| Data                                                    | Where                                 | Retention                   | Notes                                               |
| ------------------------------------------------------- | ------------------------------------- | --------------------------- | --------------------------------------------------- |
| Rate-limit counters (keys = HMAC of IP/account/route)   | Redis                                 | ≤ 1 hour                    | no raw IP stored                                    |
| Request logs (requestId, route, status, duration, role) | log platform                          | 14–30 days (configure)      | no bodies; submit route has no user id (R-01/R-07)  |
| Analytics events (allow-listed names)                   | analytics provider, post-consent only | provider default, minimized | no ids, no text                                     |
| Email delivery metadata                                 | email provider                        | provider default            | auth mail only; no tracking                         |
| Backups                                                 | provider                              | provider rotation           | deletion effective in backups after rotation (R-06) |
