import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_OPTIONS = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 160 * 1024 * 1024
} as const;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const ENCODED_PREFIX = "scrypt$v=1$N=131072,r=8,p=1";

export type PasswordValidationResult =
  | { valid: true }
  | {
      valid: false;
      reason: "PASSWORD_REQUIRED" | "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG";
    };

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

export function validatePassword(password: string): PasswordValidationResult {
  if (password.trim().length === 0) {
    return { valid: false, reason: "PASSWORD_REQUIRED" };
  }

  const length = Array.from(password).length;
  if (length < 12) {
    return { valid: false, reason: "PASSWORD_TOO_SHORT" };
  }
  if (length > 128) {
    return { valid: false, reason: "PASSWORD_TOO_LONG" };
  }

  return { valid: true };
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

function decodeField(value: string, expectedBytes: number): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length !== expectedBytes ||
    decoded.toString("base64url") !== value
  ) {
    return null;
  }
  return decoded;
}

export const nodePasswordHasher: PasswordHasher = {
  async hash(password) {
    const salt = randomBytes(SALT_BYTES);
    const key = await deriveKey(password, salt);
    return `${ENCODED_PREFIX}$${salt.toString("base64url")}$${key.toString("base64url")}`;
  },

  async verify(password, encoded) {
    try {
      const [algorithm, version, parameters, saltField, keyField, extra] =
        encoded.split("$");
      if (
        algorithm !== "scrypt" ||
        version !== "v=1" ||
        parameters !== "N=131072,r=8,p=1" ||
        saltField === undefined ||
        keyField === undefined ||
        extra !== undefined
      ) {
        return false;
      }

      const salt = decodeField(saltField, SALT_BYTES);
      const expectedKey = decodeField(keyField, KEY_BYTES);
      if (salt === null || expectedKey === null) {
        return false;
      }

      const actualKey = await deriveKey(password, salt);
      return timingSafeEqual(actualKey, expectedKey);
    } catch {
      return false;
    }
  }
};
