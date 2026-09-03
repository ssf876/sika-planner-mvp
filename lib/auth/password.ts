import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// scrypt: memory-hard KDF built into Node — no native addon to break CI, and
// honest work factors via the default N=16384, r=8, p=1 parameters.
const KEY_LENGTH_BYTES = 64;
const SALT_LENGTH_BYTES = 16;
const SCHEME = "scrypt";

/**
 * Hash a password for storage. Format: `scrypt:<base64 salt>:<base64 hash>`.
 * Passwords are NFKC-normalized so visually identical inputs hash identically.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const derived = (await scryptAsync(
    password.normalize("NFKC"),
    salt,
    KEY_LENGTH_BYTES,
  )) as Buffer;
  return `${SCHEME}:${salt.toString("base64")}:${derived.toString("base64")}`;
}

/** Constant-time password check against a stored hash. Never throws on a malformed hash — returns false. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split(":");
  if (scheme !== SCHEME || !saltB64 || !hashB64) return false;

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  if (salt.length !== SALT_LENGTH_BYTES || expected.length === 0) return false;

  const derived = (await scryptAsync(
    password.normalize("NFKC"),
    salt,
    expected.length,
  )) as Buffer;

  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}
