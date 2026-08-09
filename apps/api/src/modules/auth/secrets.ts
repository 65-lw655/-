import { createHash, randomBytes } from "node:crypto";

export function generateOpaqueSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function digestOpaqueSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}
