-- =============================================================================
-- CoursePulse — database permissions, constraints, RLS and anonymity functions
-- DESIGN DRAFT v0.1 (Phase 2).  NOT EXECUTED.  NOT TESTED.
-- =============================================================================
-- This file is a specification written as SQL. Phase 5 must: run it against a real
-- PostgreSQL instance, fix syntax/semantic errors, and cover it with the RLS test suite
-- in tests/security/rls (see security.md §9). Table and column names assume the @map values
-- in prisma/schema.prisma.
--
-- HONEST LIMITS (also in security.md):
--  * RLS here trusts ONE app-supplied input: the transaction-local setting app.user_id.
--    The role is always re-derived from the users table. If the application process is fully
--    compromised (RCE), an attacker can set app.user_id to any value. RLS is defence-in-depth
--    against application bugs (IDOR, missing filters), not a boundary against a hostile app.
--  * Row ownership policies cannot protect anonymous rows (they have no owner). Those tables are
--    protected by privilege separation + SECURITY DEFINER functions instead.
--  * Table owner (cp_owner) bypasses RLS by design (no FORCE); cp_owner is never used at runtime.
-- =============================================================================

-- ---------------------------------------------------------------------------- 1. roles
-- Passwords are provisioned out-of-band (secret manager), never in this file.
-- cp_owner : owns objects, runs migrations (direct connection). Not used by the running app.
-- cp_app   : request handling for domain data, subject to RLS.
-- cp_auth  : authentication library only (users lookup, sessions, accounts, verifications).
-- cp_maint : scheduled retention/closure jobs; EXECUTE on two functions only.
CREATE ROLE cp_app   LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE cp_auth  LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE cp_maint LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS app;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app    FROM PUBLIC;
GRANT USAGE ON SCHEMA public, app TO cp_app, cp_auth, cp_maint;

-- ---------------------------------------------------------------------------- 2. constraints Prisma cannot express
-- NOTE (risk R-09): confirm `prisma migrate diff` does not try to drop these. See plan.md Phase 5 spike.
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));

ALTER TABLE academic_semesters
  ADD CONSTRAINT semester_term CHECK (term_number BETWEEN 1 AND 4),
  ADD CONSTRAINT semester_dates CHECK (end_date > start_date);
CREATE UNIQUE INDEX one_current_semester ON academic_semesters ((true)) WHERE is_current;

ALTER TABLE feedback_forms
  ADD CONSTRAINT form_dates CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at),
  ADD CONSTRAINT form_deadline_required CHECK (status NOT IN ('ACTIVE','CLOSED') OR closes_at IS NOT NULL);
CREATE UNIQUE INDEX one_active_form_per_assignment ON feedback_forms (assignment_id) WHERE status = 'ACTIVE';

ALTER TABLE feedback_questions
  ADD CONSTRAINT question_scale CHECK (
    (type IN ('STAR_RATING','NUMERIC_RATING')
       AND scale_min IS NOT NULL AND scale_max IS NOT NULL
       AND scale_min >= 0 AND scale_max > scale_min AND scale_max <= 10)
    OR (type NOT IN ('STAR_RATING','NUMERIC_RATING') AND scale_min IS NULL AND scale_max IS NULL)),
  ADD CONSTRAINT question_star_fixed CHECK (type <> 'STAR_RATING' OR (scale_min = 1 AND scale_max = 5)),
  -- D-18: max_selections is required for (and only for) MULTIPLE_SELECTION
  ADD CONSTRAINT question_max_selections CHECK (
    (type = 'MULTIPLE_SELECTION') = (max_selections IS NOT NULL)
    AND (max_selections IS NULL OR max_selections BETWEEN 1 AND 20));

ALTER TABLE feedback_answers
  ADD CONSTRAINT answer_exactly_one_value CHECK (num_nonnulls(rating_value, boolean_value, option_id) = 1);
CREATE UNIQUE INDEX answer_unique_scalar ON feedback_answers (submission_id, question_id) WHERE option_id IS NULL;
CREATE UNIQUE INDEX answer_unique_option ON feedback_answers (submission_id, question_id, option_id) WHERE option_id IS NOT NULL;

ALTER TABLE feedback_comments ADD CONSTRAINT comment_length CHECK (char_length(body) BETWEEN 1 AND 2000);

CREATE UNIQUE INDEX one_open_deletion_request ON data_deletion_requests (user_id)
  WHERE status IN ('PENDING_CONFIRMATION','UNDER_REVIEW');

-- search (permission filtering is done by RLS + query, never by the index)
CREATE INDEX courses_search_trgm ON courses USING gin ((code || ' ' || title) gin_trgm_ops);
CREATE INDEX users_name_trgm     ON users   USING gin (name gin_trgm_ops);

-- Guard user status transitions made by the auth role (everything else goes through functions).
CREATE OR REPLACE FUNCTION app.users_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF session_user = 'cp_auth' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'PENDING_VERIFICATION'     AND NEW.status IN ('ACTIVE','PENDING_GUARDIAN_CONSENT'))
         OR (OLD.status = 'PENDING_GUARDIAN_CONSENT' AND NEW.status = 'ACTIVE')) THEN
      RAISE EXCEPTION 'status_transition_not_allowed' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role AND session_user IN ('cp_auth') THEN
    RAISE EXCEPTION 'role_change_not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_status_guard BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app.users_status_guard();

-- ---------------------------------------------------------------------------- 3. request-context helpers
-- Only app.user_id is trusted input. Role is derived from the database and requires status ACTIVE.
CREATE OR REPLACE FUNCTION app.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.role() RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public AS
$$ SELECT u.role FROM users u WHERE u.id = app.uid() AND u.status = 'ACTIVE' $$;

CREATE OR REPLACE FUNCTION app.is_admin() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT COALESCE(app.role() = 'ADMIN', false) $$;

CREATE OR REPLACE FUNCTION app.owns_assignment(p_assignment uuid) RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path = pg_catalog, public AS
$$ SELECT COALESCE(app.role() = 'INSTRUCTOR', false) AND EXISTS (
     SELECT 1 FROM instructor_course_assignments a WHERE a.id = p_assignment AND a.instructor_id = app.uid()) $$;

CREATE OR REPLACE FUNCTION app.is_eligible_for(p_form uuid) RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path = pg_catalog, public AS
$$ SELECT COALESCE(app.role() = 'STUDENT', false) AND EXISTS (
     SELECT 1 FROM feedback_eligibility e WHERE e.form_id = p_form AND e.student_id = app.uid()) $$;

CREATE OR REPLACE FUNCTION app.can_view_form(p_form uuid) RETURNS boolean LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path = pg_catalog, public AS
$$ SELECT app.is_admin()
       OR app.is_eligible_for(p_form)
       OR EXISTS (SELECT 1 FROM feedback_forms f WHERE f.id = p_form AND f.status <> 'DRAFT'
                  AND app.owns_assignment(f.assignment_id)) $$;

-- k-anonymity threshold: setting 'min_responses', default 5, never below 3.
CREATE OR REPLACE FUNCTION app.min_responses() RETURNS int LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path = pg_catalog, public AS
$$ SELECT GREATEST(3, COALESCE((SELECT (value #>> '{}')::int FROM app_settings WHERE key = 'min_responses'), 5)) $$;

-- ---------------------------------------------------------------------------- 4. grants
-- cp_app: no privileges at all on feedback_submissions / feedback_answers / feedback_comments,
-- sessions, accounts, verifications. Writes to catalog tables are admin-only via policies.
GRANT SELECT ON users, student_profiles, instructor_profiles, departments, courses, academic_semesters,
  course_enrollments, instructor_course_assignments, feedback_forms, feedback_questions, feedback_options,
  feedback_eligibility, consent_records, data_deletion_requests, app_settings TO cp_app;
GRANT UPDATE (name, updated_at) ON users TO cp_app;                       -- self-service name change only
GRANT INSERT, UPDATE, DELETE ON departments, courses, academic_semesters, course_enrollments,
  instructor_course_assignments, feedback_forms, feedback_questions, feedback_options TO cp_app; -- admin via RLS
GRANT UPDATE ON student_profiles, instructor_profiles TO cp_app;          -- admin via RLS (no INSERT/DELETE: functions)
GRANT SELECT, INSERT ON audit_logs TO cp_app;                             -- append-only; no UPDATE/DELETE
GRANT INSERT ON consent_records TO cp_app;                                -- append-only
GRANT INSERT, UPDATE ON data_deletion_requests TO cp_app;
GRANT INSERT, UPDATE ON app_settings TO cp_app;

GRANT SELECT ON users TO cp_auth;
GRANT UPDATE (email_verified, status, updated_at) ON users TO cp_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, accounts, verifications TO cp_auth;
-- cp_maint: no table privileges; only the two job functions (section 8).

-- ---------------------------------------------------------------------------- 5. RLS policies (cp_app)
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','student_profiles','instructor_profiles','departments','courses',
    'academic_semesters','course_enrollments','instructor_course_assignments','feedback_forms',
    'feedback_questions','feedback_options','feedback_eligibility','feedback_submissions',
    'feedback_answers','feedback_comments','audit_logs','consent_records','data_deletion_requests',
    'app_settings','sessions','accounts','verifications']
  LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t); END LOOP;
END $$;
-- No policy + ENABLE = default deny for any non-owner role without BYPASSRLS.
-- feedback_submissions / answers / comments / sessions / accounts / verifications get NO cp_app policy.

-- users
CREATE POLICY users_self_read   ON users FOR SELECT TO cp_app USING (id = app.uid());
CREATE POLICY users_admin_read  ON users FOR SELECT TO cp_app USING (app.is_admin());
CREATE POLICY users_self_update ON users FOR UPDATE TO cp_app USING (id = app.uid()) WITH CHECK (id = app.uid());
CREATE POLICY users_auth_read   ON users FOR SELECT TO cp_auth USING (true);
CREATE POLICY users_auth_update ON users FOR UPDATE TO cp_auth USING (true) WITH CHECK (true); -- column grants + trigger limit it
CREATE POLICY sessions_auth     ON sessions      FOR ALL TO cp_auth USING (true) WITH CHECK (true);
CREATE POLICY accounts_auth     ON accounts      FOR ALL TO cp_auth USING (true) WITH CHECK (true);
CREATE POLICY verifications_auth ON verifications FOR ALL TO cp_auth USING (true) WITH CHECK (true);
-- role/status changes and user creation: functions only (section 6). cp_app has no UPDATE(role|status).

-- profiles
CREATE POLICY sp_self_read  ON student_profiles FOR SELECT TO cp_app USING (user_id = app.uid());
CREATE POLICY sp_admin_all  ON student_profiles FOR ALL    TO cp_app USING (app.is_admin()) WITH CHECK (app.is_admin());
CREATE POLICY ip_self_read  ON instructor_profiles FOR SELECT TO cp_app USING (user_id = app.uid());
CREATE POLICY ip_admin_all  ON instructor_profiles FOR ALL    TO cp_app USING (app.is_admin()) WITH CHECK (app.is_admin());

-- catalog (readable by any ACTIVE authenticated user; writable by admin)
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['departments','courses','academic_semesters'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO cp_app USING (app.role() IS NOT NULL)', t||'_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO cp_app USING (app.is_admin()) WITH CHECK (app.is_admin())', t||'_admin', t);
  END LOOP;
END $$;

-- enrollments: student sees own rows; admin all. Instructors see NO enrollment rows (aggregates only).
CREATE POLICY enr_self_read  ON course_enrollments FOR SELECT TO cp_app USING (student_id = app.uid());
CREATE POLICY enr_admin_all  ON course_enrollments FOR ALL TO cp_app USING (app.is_admin()) WITH CHECK (app.is_admin());

-- assignments: instructor sees own; student sees assignments for courses they are enrolled in; admin all.
CREATE POLICY asg_instructor_read ON instructor_course_assignments FOR SELECT TO cp_app
  USING (instructor_id = app.uid());
CREATE POLICY asg_student_read ON instructor_course_assignments FOR SELECT TO cp_app USING (
  EXISTS (SELECT 1 FROM course_enrollments e WHERE e.student_id = app.uid()
          AND e.course_id   = instructor_course_assignments.course_id
          AND e.semester_id = instructor_course_assignments.semester_id
          AND e.section     = instructor_course_assignments.section AND e.status = 'ENROLLED'));
CREATE POLICY asg_admin_all ON instructor_course_assignments FOR ALL TO cp_app USING (app.is_admin()) WITH CHECK (app.is_admin());

-- forms / questions / options
CREATE POLICY form_read  ON feedback_forms FOR SELECT TO cp_app USING (app.can_view_form(id));
CREATE POLICY form_admin ON feedback_forms FOR ALL TO cp_app USING (app.is_admin()) WITH CHECK (app.is_admin());
CREATE POLICY q_read     ON feedback_questions FOR SELECT TO cp_app USING (app.can_view_form(form_id));
CREATE POLICY q_admin    ON feedback_questions FOR ALL TO cp_app
  USING (app.is_admin()) WITH CHECK (app.is_admin() AND EXISTS (SELECT 1 FROM feedback_forms f WHERE f.id = form_id AND f.status = 'DRAFT'));
CREATE POLICY opt_read   ON feedback_options FOR SELECT TO cp_app
  USING (EXISTS (SELECT 1 FROM feedback_questions q WHERE q.id = question_id AND app.can_view_form(q.form_id)));
CREATE POLICY opt_admin  ON feedback_options FOR ALL TO cp_app USING (app.is_admin()) WITH CHECK (app.is_admin() AND EXISTS (
  SELECT 1 FROM feedback_questions q JOIN feedback_forms f ON f.id = q.form_id WHERE q.id = question_id AND f.status = 'DRAFT'));
-- (UPDATE/DELETE on questions of non-DRAFT forms is blocked by USING + app logic; a trigger should also reject it — Phase 5.)

-- eligibility: a student reads ONLY their own rows. Admins/instructors read none (counts via functions). No direct writes.
CREATE POLICY elig_self_read ON feedback_eligibility FOR SELECT TO cp_app USING (student_id = app.uid());
REVOKE INSERT, UPDATE, DELETE ON feedback_eligibility FROM cp_app;

-- audit: admin reads; any ACTIVE user can append a row attributed to themselves
CREATE POLICY audit_admin_read ON audit_logs FOR SELECT TO cp_app USING (app.is_admin());
CREATE POLICY audit_insert     ON audit_logs FOR INSERT TO cp_app WITH CHECK (actor_id = app.uid());

-- consent: own or admin read; insert own (self-declaration) or admin (institution record)
CREATE POLICY consent_read   ON consent_records FOR SELECT TO cp_app USING (user_id = app.uid() OR app.is_admin());
CREATE POLICY consent_insert ON consent_records FOR INSERT TO cp_app
  WITH CHECK ((user_id = app.uid() AND type <> 'GUARDIAN_CONSENT') OR app.is_admin());

-- deletion requests
CREATE POLICY del_read   ON data_deletion_requests FOR SELECT TO cp_app USING (user_id = app.uid() OR app.is_admin());
CREATE POLICY del_insert ON data_deletion_requests FOR INSERT TO cp_app
  WITH CHECK (user_id = app.uid() AND status = 'PENDING_CONFIRMATION');
CREATE POLICY del_user_cancel ON data_deletion_requests FOR UPDATE TO cp_app
  USING (user_id = app.uid() AND status IN ('PENDING_CONFIRMATION','UNDER_REVIEW')) WITH CHECK (status = 'CANCELLED');
CREATE POLICY del_admin_update ON data_deletion_requests FOR UPDATE TO cp_app
  USING (app.is_admin()) WITH CHECK (app.is_admin() AND status IN ('UNDER_REVIEW','REJECTED')); -- COMPLETED only via anonymize function

-- settings: non-secret by design; any ACTIVE user may read, admin writes
CREATE POLICY set_read  ON app_settings FOR SELECT TO cp_app USING (app.role() IS NOT NULL);
CREATE POLICY set_admin ON app_settings FOR ALL TO cp_app USING (app.is_admin()) WITH CHECK (app.is_admin());

-- Directory view so students can show instructor names without reading users rows.
CREATE OR REPLACE VIEW app.instructor_directory AS
  SELECT u.id AS instructor_id, u.name AS display_name, ip.department_id
  FROM users u JOIN instructor_profiles ip ON ip.user_id = u.id
  WHERE u.status = 'ACTIVE' AND app.role() IS NOT NULL;      -- view runs with owner rights (default)
GRANT SELECT ON app.instructor_directory TO cp_app;

-- ---------------------------------------------------------------------------- 6. privileged functions (SECURITY DEFINER)
-- Every function: pins search_path, re-checks the caller, writes an audit row in the same transaction.

CREATE OR REPLACE FUNCTION app.admin_provision_user(
  p_email text, p_name text, p_role user_role, p_student_number text, p_age_group age_group, p_department uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT app.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  INSERT INTO users (email, name, role, status, email_verified, updated_at)
    VALUES (lower(p_email), p_name, p_role, 'PENDING_VERIFICATION', false, now()) RETURNING id INTO v_id;
  IF p_role = 'STUDENT' THEN
    INSERT INTO student_profiles (user_id, student_number, age_group, updated_at) VALUES (v_id, p_student_number, p_age_group, now());
  ELSIF p_role = 'INSTRUCTOR' THEN
    INSERT INTO instructor_profiles (user_id, department_id) VALUES (v_id, p_department);
  END IF;
  INSERT INTO audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
    VALUES (app.uid(), 'ADMIN', 'USER_PROVISIONED', 'user', v_id::text, jsonb_build_object('role', p_role));
  RETURN v_id;
END $$;

-- Role changes are limited to INSTRUCTOR <-> ADMIN. STUDENT is immutable (decision D-03/D-22).
CREATE OR REPLACE FUNCTION app.admin_set_user_role(p_user uuid, p_role user_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_old user_role;
BEGIN
  IF NOT app.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_user = app.uid() THEN RAISE EXCEPTION 'cannot_change_own_role' USING ERRCODE = 'P0001'; END IF;
  SELECT role INTO v_old FROM users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_old = 'STUDENT' OR p_role = 'STUDENT' THEN RAISE EXCEPTION 'student_role_immutable' USING ERRCODE = 'P0001'; END IF;
  IF v_old = 'ADMIN' AND p_role <> 'ADMIN'
     AND (SELECT count(*) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE') <= 1 THEN
    RAISE EXCEPTION 'last_admin' USING ERRCODE = 'P0001';
  END IF;
  IF p_role = 'INSTRUCTOR' AND NOT EXISTS (SELECT 1 FROM instructor_profiles WHERE user_id = p_user) THEN
    RAISE EXCEPTION 'instructor_profile_required' USING ERRCODE = 'P0001';
  END IF;
  UPDATE users SET role = p_role, updated_at = now() WHERE id = p_user;
  DELETE FROM sessions WHERE user_id = p_user;                      -- force re-login with new privileges
  INSERT INTO audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
    VALUES (app.uid(), 'ADMIN', 'USER_ROLE_CHANGED', 'user', p_user::text, jsonb_build_object('from', v_old, 'to', p_role));
END $$;

CREATE OR REPLACE FUNCTION app.admin_set_user_status(p_user uuid, p_status user_status)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_old user_status; v_role user_role;
BEGIN
  IF NOT app.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('ACTIVE','SUSPENDED') THEN RAISE EXCEPTION 'status_not_allowed' USING ERRCODE = 'P0001'; END IF;
  IF p_user = app.uid() THEN RAISE EXCEPTION 'cannot_change_own_status' USING ERRCODE = 'P0001'; END IF;
  SELECT status, role INTO v_old, v_role FROM users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_old NOT IN ('ACTIVE','SUSPENDED') THEN RAISE EXCEPTION 'status_not_allowed' USING ERRCODE = 'P0001'; END IF;
  IF v_role = 'ADMIN' AND p_status = 'SUSPENDED'
     AND (SELECT count(*) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE') <= 1 THEN
    RAISE EXCEPTION 'last_admin' USING ERRCODE = 'P0001';
  END IF;
  UPDATE users SET status = p_status, updated_at = now() WHERE id = p_user;
  IF p_status = 'SUSPENDED' THEN DELETE FROM sessions WHERE user_id = p_user; END IF;
  INSERT INTO audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
    VALUES (app.uid(), 'ADMIN', 'USER_STATUS_CHANGED', 'user', p_user::text, jsonb_build_object('from', v_old, 'to', p_status));
END $$;

CREATE OR REPLACE FUNCTION app.admin_revoke_sessions(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT app.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM sessions WHERE user_id = p_user;
  INSERT INTO audit_logs (actor_id, actor_role, action, resource_type, resource_id)
    VALUES (app.uid(), 'ADMIN', 'USER_SESSIONS_REVOKED', 'user', p_user::text);
END $$;

-- Creates eligibility rows for enrolled, ACTIVE students of the form's offering. Idempotent.
CREATE OR REPLACE FUNCTION app.sync_form_eligibility(p_form uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_n int;
BEGIN
  IF NOT app.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  INSERT INTO feedback_eligibility (student_id, form_id)
  SELECT e.student_id, f.id
  FROM feedback_forms f
  JOIN instructor_course_assignments a ON a.id = f.assignment_id
  JOIN course_enrollments e ON e.course_id = a.course_id AND e.semester_id = a.semester_id
                           AND e.section = a.section AND e.status = 'ENROLLED'
  JOIN users u ON u.id = e.student_id AND u.status = 'ACTIVE'
  WHERE f.id = p_form AND f.status IN ('DRAFT','ACTIVE')
  ON CONFLICT (student_id, form_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
    VALUES (app.uid(), 'ADMIN', 'FORM_ELIGIBILITY_SYNCED', 'feedback_form', p_form::text, jsonb_build_object('added', v_n));
  RETURN v_n;
END $$;

-- Participation counts only (no per-student status) for admins and the assigned instructor.
CREATE OR REPLACE FUNCTION app.form_participation(p_form uuid)
RETURNS TABLE (eligible int, submitted int) LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT (app.is_admin() OR EXISTS (SELECT 1 FROM feedback_forms f WHERE f.id = p_form AND f.status <> 'DRAFT'
                                    AND app.owns_assignment(f.assignment_id))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT COALESCE((SELECT f.eligible_count FROM feedback_forms f WHERE f.id = p_form),
                    (SELECT count(*)::int FROM feedback_eligibility e WHERE e.form_id = p_form)),
           (SELECT count(*)::int FROM feedback_submissions s WHERE s.form_id = p_form);
END $$;

-- Anonymize a user in place (tombstone). Never touches feedback rows (they hold no user reference).
CREATE OR REPLACE FUNCTION app.admin_complete_deletion(p_request uuid, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid; v_role user_role;
BEGIN
  IF NOT app.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT user_id INTO v_user FROM data_deletion_requests WHERE id = p_request AND status = 'UNDER_REVIEW' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found_or_not_in_review' USING ERRCODE = 'P0002'; END IF;
  SELECT role INTO v_role FROM users WHERE id = v_user;
  IF v_role = 'ADMIN' AND (SELECT count(*) FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE') <= 1 THEN
    RAISE EXCEPTION 'last_admin' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM sessions      WHERE user_id = v_user;
  DELETE FROM accounts      WHERE user_id = v_user;
  DELETE FROM student_profiles WHERE user_id = v_user;   -- cascades enrollments + eligibility
  UPDATE users SET name = 'Deleted user', email = 'deleted-' || id::text || '@deleted.invalid',
                   email_verified = false, status = 'DELETED', updated_at = now() WHERE id = v_user;
  UPDATE data_deletion_requests SET status = 'COMPLETED', resolution_note = p_note, completed_at = now(), updated_at = now()
    WHERE id = p_request;
  INSERT INTO audit_logs (actor_id, actor_role, action, resource_type, resource_id)
    VALUES (app.uid(), 'ADMIN', 'USER_ANONYMIZED', 'user', v_user::text);
END $$;

-- ---------------------------------------------------------------------------- 7. anonymous submission (the heart of the design)
-- Called by cp_app. Returns VOID so no submission id ever leaves the database.
-- Input shapes (already Zod-validated by the app; re-validated here for invariants):
--   p_answers  : [{question_id, option_id?, rating_value?, boolean_value?}]   (one element per selected option)
--   p_comments : [{question_id, body}]
CREATE OR REPLACE FUNCTION app.submit_feedback(p_form_id uuid, p_answers jsonb, p_comments jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_uid uuid := app.uid();
  v_n   int;
  v_tz  text := COALESCE((SELECT value #>> '{}' FROM app_settings WHERE key = 'institution_timezone'), 'UTC');
BEGIN
  IF v_uid IS NULL OR app.role() IS DISTINCT FROM 'STUDENT' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM feedback_forms f WHERE f.id = p_form_id AND f.status = 'ACTIVE'
                 AND now() >= COALESCE(f.opens_at, now()) AND now() < f.closes_at) THEN
    RAISE EXCEPTION 'form_unavailable' USING ERRCODE = 'P0001';
  END IF;

  -- Structural validation (type/option/scale consistency, ownership of questions and options).
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_answers) AS a(question_id uuid, option_id uuid, rating_value int, boolean_value boolean)
    LEFT JOIN feedback_questions q ON q.id = a.question_id AND q.form_id = p_form_id
    LEFT JOIN feedback_options   o ON o.id = a.option_id   AND o.question_id = a.question_id
    WHERE q.id IS NULL
       OR q.type IN ('SHORT_TEXT','LONG_TEXT')
       OR (a.option_id IS NOT NULL AND o.id IS NULL)
       OR (q.type IN ('STAR_RATING','NUMERIC_RATING')
           AND (a.rating_value IS NULL OR a.rating_value NOT BETWEEN q.scale_min AND q.scale_max
                OR a.option_id IS NOT NULL OR a.boolean_value IS NOT NULL))
       OR (q.type = 'YES_NO' AND (a.boolean_value IS NULL OR a.rating_value IS NOT NULL OR a.option_id IS NOT NULL))
       OR (q.type IN ('MULTIPLE_CHOICE','SINGLE_CHOICE','MULTIPLE_SELECTION')
           AND (a.option_id IS NULL OR a.rating_value IS NOT NULL OR a.boolean_value IS NOT NULL))
  ) THEN RAISE EXCEPTION 'invalid_answers' USING ERRCODE = 'P0001'; END IF;

  -- Duplicates; SINGLE_CHOICE allows exactly one option; MULTIPLE_SELECTION at most max_selections;
  -- MULTIPLE_CHOICE allows any number of distinct options (>= 1 when answered). (D-18)
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_answers) AS a(question_id uuid, option_id uuid)
             GROUP BY a.question_id, a.option_id HAVING count(*) > 1)
  OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_answers) AS a(question_id uuid, option_id uuid)
             JOIN feedback_questions q ON q.id = a.question_id
             WHERE q.type IN ('SINGLE_CHOICE','MULTIPLE_SELECTION')
             GROUP BY a.question_id, q.type, q.max_selections
             HAVING count(*) > CASE WHEN q.type = 'SINGLE_CHOICE' THEN 1 ELSE q.max_selections END)
  THEN RAISE EXCEPTION 'invalid_answers' USING ERRCODE = 'P0001'; END IF;

  -- Comments must target text questions of this form.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_comments) AS c(question_id uuid, body text)
    LEFT JOIN feedback_questions q ON q.id = c.question_id AND q.form_id = p_form_id AND q.type IN ('SHORT_TEXT','LONG_TEXT')
    WHERE q.id IS NULL OR c.body IS NULL OR char_length(btrim(c.body)) NOT BETWEEN 1 AND 2000
  ) THEN RAISE EXCEPTION 'invalid_comments' USING ERRCODE = 'P0001'; END IF;

  -- Required questions answered.
  IF EXISTS (
    SELECT 1 FROM feedback_questions q
    WHERE q.form_id = p_form_id AND q.is_required
      AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_answers) AS a(question_id uuid) WHERE a.question_id = q.id)
      AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(p_comments) AS c(question_id uuid, body text)
                      WHERE c.question_id = q.id AND char_length(btrim(c.body)) > 0)
  ) THEN RAISE EXCEPTION 'missing_required' USING ERRCODE = 'P0001'; END IF;

  -- Atomic duplicate guard: flips PENDING -> SUBMITTED exactly once; a concurrent duplicate blocks on the
  -- row lock, re-evaluates the WHERE clause, matches 0 rows, and fails. Same transaction as the inserts below,
  -- so a failed insert rolls the flip back. NOTHING links the eligibility row to the rows inserted next.
  UPDATE feedback_eligibility SET status = 'SUBMITTED'
   WHERE student_id = v_uid AND form_id = p_form_id AND status = 'PENDING';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'not_eligible_or_already_submitted' USING ERRCODE = 'P0001'; END IF;

  WITH s AS (
    INSERT INTO feedback_submissions (form_id, submitted_on)
    VALUES (p_form_id, (now() AT TIME ZONE v_tz)::date) RETURNING id)
  INSERT INTO feedback_answers (submission_id, question_id, option_id, rating_value, boolean_value)
  SELECT s.id, a.question_id, a.option_id, a.rating_value, a.boolean_value
  FROM s, jsonb_to_recordset(p_answers) AS a(question_id uuid, option_id uuid, rating_value int, boolean_value boolean);

  INSERT INTO feedback_comments (form_id, question_id, body)
  SELECT p_form_id, c.question_id, btrim(c.body)
  FROM jsonb_to_recordset(p_comments) AS c(question_id uuid, body text);
  -- Intentionally no audit row and no application log containing the user id for this operation.
END $$;

-- ---------------------------------------------------------------------------- 8. anonymous reads (threshold enforced in the database)
-- Content is released only for CLOSED forms with >= min_responses() submissions (decision D-06).
-- Single-form statistics; multi-form filtered analytics use app.analytics_aggregate() (signature below,
-- body to be written in Phase 11 with cell-level k-threshold: HAVING count(DISTINCT submission_id) >= k).
CREATE OR REPLACE FUNCTION app.question_stats(p_form uuid)
RETURNS TABLE (question_id uuid, category question_category, qtype question_type,
               n int, avg_rating numeric, distribution jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT (app.is_admin() OR EXISTS (SELECT 1 FROM feedback_forms f WHERE f.id = p_form AND app.owns_assignment(f.assignment_id))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM feedback_forms f WHERE f.id = p_form AND f.status IN ('CLOSED','ARCHIVED'))
     OR (SELECT count(*) FROM feedback_submissions s WHERE s.form_id = p_form) < app.min_responses() THEN
    RETURN;   -- empty result = suppressed; the API reports "insufficient responses", never the count of hidden rows
  END IF;
  RETURN QUERY
    SELECT q.id, q.category, q.type, count(DISTINCT a.submission_id)::int,
           avg(a.rating_value)::numeric(6,3),
           COALESCE(jsonb_object_agg(d.k, d.c) FILTER (WHERE d.k IS NOT NULL), '{}'::jsonb)
    FROM feedback_questions q
    LEFT JOIN feedback_answers a ON a.question_id = q.id
    LEFT JOIN LATERAL (SELECT COALESCE(a.rating_value::text, a.option_id::text, a.boolean_value::text) AS k, 1 AS c) d ON true
    WHERE q.form_id = p_form AND q.type NOT IN ('SHORT_TEXT','LONG_TEXT')
    GROUP BY q.id, q.category, q.type;
  -- NOTE: distribution aggregation above is a placeholder shape; Phase 11 replaces it with a proper
  -- count-per-bucket subquery. The access, status and threshold gates are the point of this draft.
END $$;

-- Comments: closed form + threshold + admin/owner only; random order; hidden ones excluded for instructors.
CREATE OR REPLACE FUNCTION app.form_comments(p_form uuid, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE (comment_id uuid, question_id uuid, body text, status comment_status)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_admin boolean := app.is_admin();
BEGIN
  IF NOT (v_admin OR EXISTS (SELECT 1 FROM feedback_forms f WHERE f.id = p_form AND app.owns_assignment(f.assignment_id))) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM feedback_forms f WHERE f.id = p_form AND f.status IN ('CLOSED','ARCHIVED'))
     OR (SELECT count(*) FROM feedback_submissions s WHERE s.form_id = p_form) < app.min_responses() THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT c.id, c.question_id, c.body, c.status FROM feedback_comments c
    WHERE c.form_id = p_form AND (v_admin OR c.status = 'VISIBLE')
    ORDER BY md5(c.id::text || p_form::text)          -- stable pseudo-random order, not insertion order
    LIMIT LEAST(p_limit, 100) OFFSET p_offset;
END $$;

CREATE OR REPLACE FUNCTION app.admin_moderate_comment(p_comment uuid, p_status comment_status, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT app.is_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE feedback_comments SET status = p_status WHERE id = p_comment;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
    VALUES (app.uid(), 'ADMIN', 'COMMENT_MODERATED', 'feedback_comment', p_comment::text,
            jsonb_build_object('status', p_status, 'reason', left(p_reason, 200)));
END $$;

-- Signature only (Phase 11): app.analytics_aggregate(p_filters jsonb, p_group_by text)
--   returns rows (group_key, n_submissions, avg_normalized_0_100, distribution) for groups with
--   >= min_responses() DISTINCT submissions, over CLOSED forms the caller may view; INSTRUCTOR scope is
--   forced to own assignments inside the function; INSTRUCTOR date filters are rejected for content metrics.

-- ---------------------------------------------------------------------------- 9. maintenance jobs (cp_maint only)
CREATE OR REPLACE FUNCTION app.close_expired_forms() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_n int;
BEGIN
  IF session_user <> 'cp_maint' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  WITH c AS (
    UPDATE feedback_forms f SET status = 'CLOSED',
           eligible_count = (SELECT count(*) FROM feedback_eligibility e WHERE e.form_id = f.id), updated_at = now()
    WHERE f.status = 'ACTIVE' AND f.closes_at <= now() RETURNING f.id)
  SELECT count(*) INTO v_n FROM c;
  RETURN v_n;
END $$;

-- Retention (defaults in docs/data-inventory.md; read from app_settings, institution to confirm).
CREATE OR REPLACE FUNCTION app.purge_expired() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  g int := COALESCE((SELECT (value #>> '{}')::int FROM app_settings WHERE key='retain_eligibility_days'), 180);
  a int := COALESCE((SELECT (value #>> '{}')::int FROM app_settings WHERE key='retain_audit_days'), 730);
  f int := COALESCE((SELECT (value #>> '{}')::int FROM app_settings WHERE key='retain_feedback_days'), 1825);
BEGIN
  IF session_user <> 'cp_maint' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  DELETE FROM sessions      WHERE expires_at < now();
  DELETE FROM verifications WHERE expires_at < now();
  DELETE FROM feedback_eligibility e USING feedback_forms fm
    WHERE fm.id = e.form_id AND fm.status IN ('CLOSED','ARCHIVED') AND fm.closes_at < now() - make_interval(days => g);
  DELETE FROM audit_logs WHERE created_at < now() - make_interval(days => a);
  DELETE FROM feedback_submissions s USING feedback_forms fm   -- cascades answers
    WHERE fm.id = s.form_id AND fm.status IN ('CLOSED','ARCHIVED') AND fm.closes_at < now() - make_interval(days => f);
  DELETE FROM feedback_comments c USING feedback_forms fm
    WHERE fm.id = c.form_id AND fm.status IN ('CLOSED','ARCHIVED') AND fm.closes_at < now() - make_interval(days => f);
END $$;

-- ---------------------------------------------------------------------------- 10. execute grants
GRANT EXECUTE ON FUNCTION app.uid(), app.role(), app.is_admin(), app.owns_assignment(uuid), app.is_eligible_for(uuid),
  app.can_view_form(uuid), app.min_responses() TO cp_app;
GRANT EXECUTE ON FUNCTION app.admin_provision_user(text,text,user_role,text,age_group,uuid), app.admin_set_user_role(uuid,user_role),
  app.admin_set_user_status(uuid,user_status), app.admin_revoke_sessions(uuid), app.sync_form_eligibility(uuid),
  app.form_participation(uuid), app.admin_complete_deletion(uuid,text), app.submit_feedback(uuid,jsonb,jsonb),
  app.question_stats(uuid), app.form_comments(uuid,int,int), app.admin_moderate_comment(uuid,comment_status,text) TO cp_app;
GRANT EXECUTE ON FUNCTION app.close_expired_forms(), app.purge_expired() TO cp_maint;
-- cp_auth needs no function grants except the trigger (runs as table owner context).

-- ---------------------------------------------------------------------------- 11. required tests (tests/security/rls)
-- Run as the real cp_app / cp_auth / cp_maint roles against a production-like database:
--  * student A cannot read student B's enrollments/eligibility; cannot read any submission/answer/comment table
--  * instructor cannot read enrollments, eligibility, other instructors' forms; cannot call question_stats on others' forms
--  * question_stats / form_comments return nothing for ACTIVE forms and for forms below the threshold
--  * submit_feedback: duplicate, concurrent double-submit (two connections), expired form, wrong form, wrong option,
--    out-of-scale rating, missing required, non-student caller, suspended student
--  * no role-escalation path: UPDATE users SET role ... as cp_app and as cp_auth must fail
--  * audit_logs: UPDATE/DELETE as cp_app must fail; insert with another actor_id must fail
--  * cp_app has no privilege on sessions/accounts/verifications and on the three anonymous tables
--  * setting app.user_id to an unknown or SUSPENDED user yields zero rows everywhere
