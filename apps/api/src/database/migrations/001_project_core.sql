CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension AS extension
    JOIN pg_namespace AS namespace
      ON namespace.oid = extension.extnamespace
    WHERE extension.extname = 'pg_trgm'
      AND namespace.nspname <> 'public'
  ) THEN
    RAISE EXCEPTION 'pg_trgm extension must be installed in public schema';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL
);

CREATE SEQUENCE project_commit_sequence AS bigint START WITH 1;

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  name varchar(200) NOT NULL,
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  type varchar(100) NOT NULL,
  status varchar(32) NOT NULL CHECK (
    status IN (
      '中标待签',
      '施工中',
      '深化中',
      '完工未验收',
      '待验收',
      '验收未结算',
      '结算未回款',
      '已结算待回款'
    )
  ),
  phase varchar(100) NOT NULL,
  lifecycle varchar(16) NOT NULL CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  filing_status varchar(100) NOT NULL,
  planned_completion_date date,
  actual_completion_date date,
  created_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  commit_sequence bigint NOT NULL UNIQUE,
  archived_at timestamptz,
  archived_by uuid
);

CREATE INDEX projects_lifecycle_idx ON projects (lifecycle);
CREATE INDEX projects_year_idx ON projects (year);
CREATE INDEX projects_status_idx ON projects (status);
CREATE INDEX projects_updated_at_idx ON projects (updated_at DESC);
CREATE INDEX projects_name_trgm_idx ON projects USING gin (name public.gin_trgm_ops);

CREATE TABLE project_members (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  member_role varchar(16) NOT NULL CHECK (
    member_role IN ('OWNER', 'EDITOR', 'VIEWER')
  ),
  job_title varchar(100) NOT NULL DEFAULT '',
  phone varchar(50) NOT NULL DEFAULT '',
  remark varchar(1000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by uuid NOT NULL,
  UNIQUE (project_id, user_id)
);

CREATE TABLE project_audit_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  commit_sequence bigint NOT NULL UNIQUE,
  event_type varchar(32) NOT NULL CHECK (
    event_type IN (
      'PROJECT_CREATED',
      'PROJECT_UPDATED',
      'PROJECT_ARCHIVED',
      'PROJECT_RESTORED',
      'MEMBER_ADDED',
      'MEMBER_UPDATED',
      'MEMBER_REMOVED'
    )
  ),
  actor_user_id uuid NOT NULL,
  target_type varchar(32) NOT NULL CHECK (
    target_type IN ('PROJECT', 'PROJECT_MEMBER')
  ),
  target_id uuid NOT NULL,
  change_summary jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX project_audit_events_project_commit_sequence_idx
  ON project_audit_events (project_id, commit_sequence DESC);
