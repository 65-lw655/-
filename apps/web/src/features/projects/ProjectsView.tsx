import { useMemo, useState } from "react";

import type { SessionUser } from "../auth/auth-client.js";
import { ProjectDetailView } from "./ProjectDetailView.js";
import { ProjectEditorDialog } from "./ProjectEditorDialog.js";
import { ProjectListView } from "./ProjectListView.js";
import { createProjectsClient } from "./projects-client.js";

export interface ProjectsViewProps {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  sessionUser: SessionUser;
  onOpenProject(projectId: string): void;
  onSessionExpired(): void;
}

export function ProjectsView({
  apiBaseUrl,
  fetchImpl,
  sessionUser,
  onOpenProject,
  onSessionExpired
}: ProjectsViewProps) {
  const client = useMemo(
    () => createProjectsClient(apiBaseUrl, fetchImpl),
    [apiBaseUrl, fetchImpl]
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );

  if (selectedProjectId !== null) {
    return (
      <ProjectDetailView
        client={client}
        onBack={() => {
          setSelectedProjectId(null);
          setRefreshToken((value) => value + 1);
        }}
        onSessionExpired={onSessionExpired}
        projectId={selectedProjectId}
      />
    );
  }

  return (
    <>
      <ProjectListView
        client={client}
        onCreateProject={() => setCreateOpen(true)}
        onOpenProject={(projectId) => {
          setSelectedProjectId(projectId);
          onOpenProject(projectId);
        }}
        onSessionExpired={onSessionExpired}
        refreshToken={refreshToken}
        sessionRole={sessionUser.role}
      />
      {createOpen ? (
        <ProjectEditorDialog
          client={client}
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSaved={() => setRefreshToken((value) => value + 1)}
          onSessionExpired={onSessionExpired}
        />
      ) : null}
    </>
  );
}
