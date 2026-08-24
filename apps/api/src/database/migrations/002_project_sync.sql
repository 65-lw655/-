CREATE TABLE sync_operation_results (
  device_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  project_id uuid NOT NULL,
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

CREATE INDEX project_change_log_entity_revision_idx
  ON project_change_log (entity_type, entity_id, revision DESC);

CREATE FUNCTION enforce_project_change_log_revision_monotonicity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_revision integer;
BEGIN
  SELECT revision
    INTO latest_revision
    FROM project_change_log
   WHERE entity_type = NEW.entity_type
     AND entity_id = NEW.entity_id
   ORDER BY revision DESC
   LIMIT 1;

  IF latest_revision IS NOT NULL AND NEW.revision <= latest_revision THEN
    RAISE EXCEPTION
      'project_change_log revision must increase for entity %, existing %, got %',
      NEW.entity_id,
      latest_revision,
      NEW.revision;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER project_change_log_revision_monotonicity_trigger
BEFORE INSERT ON project_change_log
FOR EACH ROW
EXECUTE FUNCTION enforce_project_change_log_revision_monotonicity();
