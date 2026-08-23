import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PostgresProjectRepository } from "./postgres-project-repository.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const legalAuditFields = [
  "name",
  "year",
  "type",
  "status",
  "phase",
  "filingStatus",
  "plannedCompletionDate",
  "actualCompletionDate",
  "lifecycle",
  "memberRole",
  "jobTitle",
  "phone",
  "remark"
] as const;
const legalAuditValueFields = [
  "name",
  "year",
  "type",
  "status",
  "phase",
  "filingStatus",
  "plannedCompletionDate",
  "actualCompletionDate",
  "lifecycle",
  "memberRole"
] as const;

function repositoryWithAuditSummary(changeSummary: unknown) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("count(*)")) {
      return { rows: [{ total: "1" }] };
    }
    if (sql.includes("FROM project_audit_events")) {
      return {
        rows: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            project_id: projectId,
            commit_sequence: "1",
            event_type: "PROJECT_UPDATED",
            actor_user_id: "33333333-3333-4333-8333-333333333333",
            target_type: "PROJECT",
            target_id: projectId,
            change_summary: changeSummary,
            occurred_at: "2026-08-14T08:00:00.000Z"
          }
        ]
      };
    }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return new PostgresProjectRepository(pool);
}

async function listAudit(changeSummary: unknown) {
  const repository = repositoryWithAuditSummary(changeSummary);
  return repository.transaction((transaction) =>
    transaction.listAudit(projectId, 1, 20)
  );
}

describe("PostgresProjectRepository audit mapping", () => {
  it("preserves every audit field name with only safe before and after values", async () => {
    const values = Object.fromEntries(
      legalAuditValueFields.map((field) => [
        field,
        field === "year" ? null : field
      ])
    );
    const changeSummary = {
      fields: legalAuditFields,
      before: values,
      after: values
    };

    const page = await listAudit(changeSummary);

    expect(page.items[0]?.changeSummary).toEqual(changeSummary);
  });

  it.each([
    ["non-object", null],
    ["invalid JSON", "{not-json"],
    ["missing fields", {}],
    ["non-array fields", { fields: "name" }],
    ["non-string field", { fields: [1] }],
    ["unknown field", { fields: ["privateField"] }],
    ["unknown summary key", { fields: ["name"], privateField: "hidden" }],
    [
      "unknown before key",
      { fields: ["name"], before: { privateField: "hidden" } }
    ],
    ["invalid before value", { fields: ["name"], before: { name: 1 } }],
    [
      "sensitive job title before value",
      { fields: ["jobTitle"], before: { jobTitle: "not-public" } }
    ],
    [
      "unknown after key",
      { fields: ["name"], after: { privateField: "hidden" } }
    ],
    [
      "sensitive phone after value",
      { fields: ["phone"], after: { phone: "not-public" } }
    ],
    [
      "sensitive remark after value",
      { fields: ["remark"], after: { remark: "not-public" } }
    ]
  ])("rejects %s with a generic mapping error", async (_label, value) => {
    await expect(listAudit(value)).rejects.toThrow(
      "PostgreSQL audit change summary mapping failed"
    );
  });
});
