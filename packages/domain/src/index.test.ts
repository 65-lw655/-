import { describe, expect, it } from "vitest";

import { SYSTEM_VERSION } from "./index.js";

describe("SYSTEM_VERSION", () => {
  it("uses the M1 baseline version", () => {
    expect(SYSTEM_VERSION).toBe("0.1.0");
  });
});
