CREATE TABLE sync_operation_results (
  device_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  entity_id uuid NOT NULL,
  entity_type varchar(32) NOT NULL CHECK (entity_type IN ('PROJECT')),
  status varchar(32) NOT NULL CHECK (
    status IN (
      'ACCEPTED',
      'DUPLICATE',
      'FORBIDDEN',
      'VALIDATION_FAILED',
      'NOT_FOUND',
      'RETRYABLE',
      'PROTOCOL_UNSUPPORTED'
    )
  ),
  result_payload jsonb NOT NULL,
  error_code varchar(64),
  created_at timestamptz NOT NULL,
  actor_user_id uuid NOT NULL,
  PRIMARY KEY (device_id, operation_id)
);

CREATE INDEX sync_operation_results_project_created_at_idx
  ON sync_operation_results (project_id, created_at DESC);

CREATE TABLE project_change_log (
  commit_sequence bigint PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  entity_id uuid NOT NULL,
  entity_type varchar(32) NOT NULL CHECK (entity_type IN ('PROJECT')),
  revision integer NOT NULL CHECK (revision >= 1),
  deleted boolean NOT NULL,
  project_snapshot jsonb,
  actor_user_id uuid NOT NULL,
  changed_at timestamptz NOT NULL,
  CHECK (
    (deleted = true AND project_snapshot IS NULL) OR
    (deleted = false AND project_snapshot IS NOT NULL)
  )
);

CREATE INDEX project_change_log_project_commit_sequence_idx
  ON project_change_log (project_id, commit_sequence ASC);

CREATE INDEX project_change_log_entity_commit_sequence_idx
  ON project_change_log (entity_type, entity_id, commit_sequence DESC);
