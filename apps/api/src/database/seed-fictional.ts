import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PostgresProjectRepository } from "../modules/projects/postgres-project-repository.js";
import type { ProjectTransaction } from "../modules/projects/project-repository.js";
import { createDatabasePool } from "./pool.js";

type FictionalSeedTransaction = Pick<
  ProjectTransaction,
  | "getAccess"
  | "nextCommitSequence"
  | "createProject"
  | "addMember"
  | "writeAudit"
>;

interface FictionalSeedRepository {
  transaction<T>(
    work: (transaction: FictionalSeedTransaction) => Promise<T>
  ): Promise<T>;
}

interface SeedFictionalDataOptions {
  confirmation: string | undefined;
  adminUserId: string;
  ownerUserId: string;
  repository: FictionalSeedRepository;
}

const fictionalProject = {
  id: "f1c71000-0000-4000-8000-000000000001",
  name: "示例-项目核心演示",
  year: 2026,
  type: "展览展示",
  status: "施工中" as const,
  phase: "项目实施",
  filingStatus: "无需报建",
  plannedCompletionDate: null,
  actualCompletionDate: null
};
const fictionalOwnerMemberId = "f1c71000-0000-4000-8000-000000000002";
const fictionalAuditEventId = "f1c71000-0000-4000-8000-000000000003";
const uuidPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

export async function seedFictionalData({
  confirmation,
  adminUserId,
  ownerUserId,
  repository
}: SeedFictionalDataOptions): Promise<void> {
  if (confirmation !== "yes") {
    throw new Error("SEED_FICTIONAL_DATA=yes is required");
  }
  const trimmedAdminUserId = adminUserId.trim();
  const trimmedOwnerUserId = ownerUserId.trim();
  if (
    !uuidPattern.test(trimmedAdminUserId) ||
    !uuidPattern.test(trimmedOwnerUserId)
  ) {
    throw new Error("Explicit fictional user IDs are required");
  }

  await repository.transaction(async (transaction) => {
    const access = await transaction.getAccess(
      fictionalProject.id,
      trimmedAdminUserId,
      true
    );
    if (access.project !== null) {
      return;
    }

    const commitSequence = await transaction.nextCommitSequence();
    const occurredAt = new Date().toISOString();
    await transaction.createProject({
      ...fictionalProject,
      actorUserId: trimmedAdminUserId,
      occurredAt,
      commitSequence
    });
    await transaction.addMember({
      id: fictionalOwnerMemberId,
      projectId: fictionalProject.id,
      userId: trimmedOwnerUserId,
      memberRole: "OWNER",
      jobTitle: "",
      phone: "",
      remark: "",
      actorUserId: trimmedAdminUserId,
      occurredAt
    });
    await transaction.writeAudit({
      id: fictionalAuditEventId,
      projectId: fictionalProject.id,
      commitSequence,
      eventType: "PROJECT_CREATED",
      actorUserId: trimmedAdminUserId,
      targetType: "PROJECT",
      targetId: fictionalProject.id,
      changeSummary: {
        fields: ["name", "year", "type", "status", "phase", "filingStatus"]
      },
      occurredAt
    });
  });
}

function commandArgument(name: string): string {
  const argumentIndex = process.argv.indexOf(name);
  return argumentIndex === -1 ? "" : (process.argv[argumentIndex + 1] ?? "");
}

async function runCli(): Promise<void> {
  const pool = createDatabasePool(process.env.DATABASE_URL ?? "");
  try {
    await seedFictionalData({
      confirmation: process.env.SEED_FICTIONAL_DATA,
      adminUserId: commandArgument("--admin-user-id"),
      ownerUserId: commandArgument("--owner-user-id"),
      repository: new PostgresProjectRepository(pool)
    });
  } finally {
    await pool.end();
  }
}

const executedFile = process.argv[1];
if (
  executedFile !== undefined &&
  import.meta.url === pathToFileURL(resolve(executedFile)).href
) {
  runCli().catch(() => {
    process.stderr.write("Fictional seed failed\n");
    process.exitCode = 1;
  });
}
