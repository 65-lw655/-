export type WebConfigResult =
  | { ok: true; apiBaseUrl: string }
  | { ok: false; message: "API 地址未配置" | "API 地址格式无效" };

export function resolveWebConfig(
  apiBaseUrl: string | undefined
): WebConfigResult {
  const value = apiBaseUrl?.trim();
  if (!value) {
    return { ok: false, message: "API 地址未配置" };
  }

  const normalized = value.replace(/\/+$/, "");
  if (normalized.startsWith("/") && !normalized.startsWith("//")) {
    return { ok: true, apiBaseUrl: normalized };
  }

  try {
    const url = new URL(normalized);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { ok: true, apiBaseUrl: normalized };
    }
  } catch {
    // Invalid URLs return the public configuration error below.
  }

  return { ok: false, message: "API 地址格式无效" };
}
