CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE device_settings (
  device_id TEXT PRIMARY KEY,
  next_client_sequence INTEGER NOT NULL CHECK (next_client_sequence > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE local_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
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
  phase TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  filing_status TEXT NOT NULL,
  planned_completion_date TEXT,
  actual_completion_date TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  commit_sequence INTEGER NOT NULL UNIQUE CHECK (commit_sequence >= 1),
  archived_at TEXT,
  archived_by TEXT,
  can_edit INTEGER NOT NULL CHECK (can_edit IN (0, 1)),
  local_updated_at TEXT NOT NULL,
  sync_state TEXT NOT NULL CHECK (sync_state IN ('SYNCED', 'PENDING'))
);

CREATE TABLE sync_outbox (
  operation_id TEXT PRIMARY KEY,
  protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
  device_id TEXT NOT NULL,
  client_sequence INTEGER NOT NULL CHECK (client_sequence > 0),
  entity_type TEXT NOT NULL CHECK (entity_type = 'PROJECT'),
  entity_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action = 'UPSERT'),
  base_revision INTEGER NOT NULL CHECK (base_revision >= 1),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (device_id, client_sequence),
  FOREIGN KEY (project_id) REFERENCES local_projects(id)
);

CREATE INDEX local_projects_name_idx ON local_projects (name);
CREATE INDEX local_projects_year_idx ON local_projects (year);
CREATE INDEX local_projects_status_idx ON local_projects (status);
CREATE INDEX local_projects_lifecycle_idx ON local_projects (lifecycle);
