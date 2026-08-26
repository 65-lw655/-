ALTER TABLE sync_outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0);
ALTER TABLE sync_outbox ADD COLUMN last_error TEXT;

CREATE TABLE sync_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  project_commit_sequence INTEGER NOT NULL DEFAULT 0 CHECK (project_commit_sequence >= 0)
);

INSERT INTO sync_cursor (id, project_commit_sequence) VALUES (1, 0);
