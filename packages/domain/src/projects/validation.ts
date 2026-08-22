import {
  PROJECT_STATUSES,
  type ProjectStatus,
  type ValidationResult
} from "./types.js";

const projectMemberRoles = ["OWNER", "EDITOR", "VIEWER"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasLengthBetween = (value: unknown, minimum: number, maximum: number) =>
  typeof value === "string" &&
  [...value].length >= minimum &&
  [...value].length <= maximum;

const isRealDate = (value: unknown) => {
  if (value === null) {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];

  const maximumDay = daysInMonth[month - 1] ?? 0;

  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= maximumDay;
};

const resultFor = (fields: Record<string, string>): ValidationResult =>
  Object.keys(fields).length === 0 ? { ok: true } : { ok: false, fields };

export const validateProjectInput = (input: unknown): ValidationResult => {
  if (!isRecord(input)) {
    return { ok: false, fields: { input: "必须是对象" } };
  }

  const fields: Record<string, string> = {};

  if (
    !hasLengthBetween(input.name, 1, 200) ||
    typeof input.name !== "string" ||
    input.name.trim().length === 0
  ) {
    fields.name = "长度必须为 1-200 个字符";
  }
  if (
    typeof input.year !== "number" ||
    !Number.isInteger(input.year) ||
    input.year < 1900 ||
    input.year > 2100
  ) {
    fields.year = "必须为 1900-2100 的整数";
  }
  if (!hasLengthBetween(input.type, 0, 100)) {
    fields.type = "长度不能超过 100 个字符";
  }
  if (
    typeof input.status !== "string" ||
    !PROJECT_STATUSES.includes(input.status as ProjectStatus)
  ) {
    fields.status = "状态无效";
  }
  if (!hasLengthBetween(input.phase, 0, 100)) {
    fields.phase = "长度不能超过 100 个字符";
  }
  if (!hasLengthBetween(input.filingStatus, 0, 100)) {
    fields.filingStatus = "长度不能超过 100 个字符";
  }
  if (!isRealDate(input.plannedCompletionDate)) {
    fields.plannedCompletionDate = "必须是真实的 YYYY-MM-DD 日期或 null";
  }
  if (!isRealDate(input.actualCompletionDate)) {
    fields.actualCompletionDate = "必须是真实的 YYYY-MM-DD 日期或 null";
  }

  return resultFor(fields);
};

export const validateMemberInput = (input: unknown): ValidationResult => {
  if (!isRecord(input)) {
    return { ok: false, fields: { input: "必须是对象" } };
  }

  const fields: Record<string, string> = {};

  if (
    typeof input.memberRole !== "string" ||
    !projectMemberRoles.includes(
      input.memberRole as (typeof projectMemberRoles)[number]
    )
  ) {
    fields.memberRole = "成员角色无效";
  }
  if (!hasLengthBetween(input.jobTitle, 0, 100)) {
    fields.jobTitle = "长度不能超过 100 个字符";
  }
  if (!hasLengthBetween(input.phone, 0, 50)) {
    fields.phone = "长度不能超过 50 个字符";
  }
  if (!hasLengthBetween(input.remark, 0, 1000)) {
    fields.remark = "长度不能超过 1000 个字符";
  }

  return resultFor(fields);
};
