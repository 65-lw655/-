import { describe, expect, it } from "vitest";

import { createDatabasePool } from "./pool.js";

describe("createDatabasePool", () => {
  it("handles idle client errors without an uncaught event", async () => {
    const pool = createDatabasePool("postgresql://example.invalid/unit-test");

    try {
      expect(() =>
        pool.emit("error", new Error("fictional idle client failure"))
      ).not.toThrow();
      expect(pool.listenerCount("error")).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
