// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DesktopApp } from "./DesktopApp.js";

describe("DesktopApp", () => {
  it("renders the local desktop entry without checking network state", () => {
    render(<DesktopApp />);
    expect(screen.getByRole("heading", { name: "本机项目" })).toBeVisible();
    expect(screen.getByText("正在准备本地数据")).toBeVisible();
  });
});
