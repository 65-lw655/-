import { describe, expect, it } from "vitest";

import { resolveApiProxyTarget } from "./vite.config.js";

describe("resolveApiProxyTarget", () => {
  it("uses the local API by default", () => {
    expect(resolveApiProxyTarget({})).toBe("http://127.0.0.1:3000");
  });

  it("uses a trimmed explicit development proxy target", () => {
    expect(
      resolveApiProxyTarget({
        VITE_DEV_API_PROXY_TARGET: "  http://127.0.0.1:3100  "
      })
    ).toBe("http://127.0.0.1:3100");
  });
});
