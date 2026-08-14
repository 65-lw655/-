import { describe, expect, it } from "vitest";

import { authorizeAction } from "./authorization.js";
import type { AuthorizationContext, ProjectMemberRole } from "./types.js";

const user = (memberRole: ProjectMemberRole | null): AuthorizationContext => ({
  accountStatus: "ACTIVE",
  credentialStatus: "READY",
  sessionValid: true,
  systemRole: "USER",
  projectExists: true,
  memberRole
});

const leader = (
  memberRole: ProjectMemberRole | null
): AuthorizationContext => ({
  ...user(memberRole),
  systemRole: "LEADER"
});

const admin = (memberRole: ProjectMemberRole | null): AuthorizationContext => ({
  ...user(memberRole),
  systemRole: "ADMIN"
});

const disabledUser = (
  memberRole: ProjectMemberRole | null
): AuthorizationContext => ({
  ...user(memberRole),
  accountStatus: "DISABLED"
});

describe("authorizeAction", () => {
  const cases = [
    ["非成员普通用户读取", user(null), "PROJECT_READ", false],
    ["VIEWER 读取合同", user("VIEWER"), "PROJECT_READ", true],
    ["VIEWER 修改合同", user("VIEWER"), "BUSINESS_UPDATE", false],
    ["EDITOR 新增回款", user("EDITOR"), "BUSINESS_CREATE", true],
    ["EDITOR 管理成员", user("EDITOR"), "MEMBER_MANAGE", false],
    ["OWNER 管理成员", user("OWNER"), "MEMBER_MANAGE", true],
    ["OWNER 移除最后负责人", user("OWNER"), "REMOVE_LAST_OWNER", false],
    ["非成员领导读取", leader(null), "PROJECT_READ", true],
    ["非成员领导修改", leader(null), "BUSINESS_UPDATE", false],
    ["管理员创建项目", admin(null), "PROJECT_CREATE", true],
    ["管理员跨项目修改", admin(null), "BUSINESS_UPDATE", true],
    ["管理员管理用户", admin(null), "USER_MANAGE", true],
    ["成员下载文件", user("VIEWER"), "FILE_DOWNLOAD", true],
    ["领导跨项目下载", leader(null), "FILE_DOWNLOAD", true],
    ["权限撤销后同步写入", user(null), "SYNC_WRITE", false],
    ["停用账号访问", disabledUser("OWNER"), "PROJECT_READ", false],
    ["OWNER 完整导出", user("OWNER"), "PROJECT_EXPORT", true],
    ["非成员管理员完整导出", admin(null), "PROJECT_EXPORT", false],
    ["管理员角色撤销后同步写入", user(null), "SYNC_WRITE", false]
  ] as const;

  it.each(cases)("%s", (_scenario, context, action, allowed) => {
    expect(authorizeAction(context, action)).toMatchObject({ allowed });
  });

  it("marks administrator cross-project business writes for audit", () => {
    expect(authorizeAction(admin(null), "BUSINESS_UPDATE")).toEqual({
      allowed: true,
      auditRequired: true
    });
  });

  it("marks leader cross-project file downloads for audit", () => {
    expect(authorizeAction(leader(null), "FILE_DOWNLOAD")).toEqual({
      allowed: true,
      auditRequired: true
    });
  });

  it.each(["USER", "LEADER", "ADMIN"] as const)(
    "always denies audit mutations for %s",
    (systemRole) => {
      expect(
        authorizeAction({ ...user("OWNER"), systemRole }, "AUDIT_MUTATE")
      ).toEqual({ allowed: false, reason: "FORBIDDEN" });
    }
  );

  it("applies authorization gates in the documented order", () => {
    expect(
      authorizeAction(
        { ...user("OWNER"), accountStatus: "DISABLED" },
        "PROJECT_READ"
      )
    ).toEqual({ allowed: false, reason: "ACCOUNT_DISABLED" });
    expect(
      authorizeAction(
        {
          ...user("OWNER"),
          credentialStatus: "PENDING_ACTIVATION",
          sessionValid: false
        },
        "PROJECT_READ"
      )
    ).toEqual({ allowed: false, reason: "CREDENTIAL_NOT_READY" });
    expect(
      authorizeAction(
        { ...user("OWNER"), sessionValid: false, projectExists: false },
        "PROJECT_READ"
      )
    ).toEqual({ allowed: false, reason: "SESSION_INVALID" });
    expect(
      authorizeAction(
        { ...user("OWNER"), projectExists: false },
        "PROJECT_READ"
      )
    ).toEqual({ allowed: false, reason: "PROJECT_NOT_FOUND" });
  });

  it("allows only administrator system operations without an existing project", () => {
    const noProjectAdmin = { ...admin(null), projectExists: false };

    expect(authorizeAction(noProjectAdmin, "PROJECT_CREATE")).toEqual({
      allowed: true,
      auditRequired: false
    });
    expect(authorizeAction(noProjectAdmin, "USER_MANAGE")).toEqual({
      allowed: true,
      auditRequired: false
    });
    expect(authorizeAction(noProjectAdmin, "PROJECT_READ")).toEqual({
      allowed: false,
      reason: "PROJECT_NOT_FOUND"
    });
  });
});
