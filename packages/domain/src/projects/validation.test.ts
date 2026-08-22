import { describe, expect, it } from "vitest";

import { validateMemberInput, validateProjectInput } from "./validation.js";

const projectInput = {
  name: "虚构展陈项目",
  year: 2026,
  type: "展览展示",
  status: "施工中",
  phase: "现场实施",
  filingStatus: "无需报建",
  plannedCompletionDate: "2026-12-31",
  actualCompletionDate: null
};

describe("validateProjectInput", () => {
  it("accepts the M3 project fields", () => {
    expect(validateProjectInput(projectInput)).toEqual({ ok: true });
  });

  it("rejects blank names and invalid business dates", () => {
    expect(validateProjectInput({ name: " ", year: 2026 })).toMatchObject({
      ok: false
    });
    expect(
      validateProjectInput({
        ...projectInput,
        plannedCompletionDate: "2026-02-30"
      })
    ).toMatchObject({ ok: false });
  });

  it("counts project strings by Unicode code point within their limits", () => {
    expect(
      validateProjectInput({
        ...projectInput,
        name: "😀".repeat(200),
        type: "展".repeat(100),
        phase: "展".repeat(100),
        filingStatus: "展".repeat(100)
      })
    ).toEqual({ ok: true });
    expect(
      validateProjectInput({ ...projectInput, name: "😀".repeat(201) })
    ).toMatchObject({ ok: false });
  });
});

describe("validateMemberInput", () => {
  it("accepts all three project roles and bounded profile fields", () => {
    for (const memberRole of ["OWNER", "EDITOR", "VIEWER"] as const) {
      expect(
        validateMemberInput({
          memberRole,
          jobTitle: "项目经理",
          phone: "",
          remark: ""
        })
      ).toEqual({ ok: true });
    }
  });

  it("rejects invalid roles and fields beyond their Unicode limits", () => {
    expect(
      validateMemberInput({
        memberRole: "ADMIN",
        jobTitle: "",
        phone: "",
        remark: ""
      })
    ).toMatchObject({ ok: false });
    expect(
      validateMemberInput({
        memberRole: "OWNER",
        jobTitle: "😀".repeat(101),
        phone: "",
        remark: ""
      })
    ).toMatchObject({ ok: false });
  });
});
