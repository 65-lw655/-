// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SyncStatus } from "./SyncStatus.js";

describe("SyncStatus", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows ready copy with no pending operations", () => {
    render(<SyncStatus pendingCount={0} />);

    expect(screen.getByText("本机数据已就绪")).toBeVisible();
    expect(screen.getByText("同步已就绪")).toBeVisible();
  });

  it("shows singular pending copy", () => {
    render(<SyncStatus pendingCount={1} />);

    expect(screen.getByText("1 项修改待同步")).toBeVisible();
    expect(screen.getByText("同步已就绪")).toBeVisible();
  });

  it("shows plural pending copy", () => {
    render(<SyncStatus pendingCount={3} />);

    expect(screen.getByText("3 项修改待同步")).toBeVisible();
    expect(screen.getByText("同步已就绪")).toBeVisible();
  });
});
