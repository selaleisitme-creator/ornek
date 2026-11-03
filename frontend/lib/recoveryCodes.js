import "server-only";
import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// No 0/O or 1/I so codes written on paper are not misread.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_COUNT = 8;

export function generateCodes() {
  return Array.from({ length: CODE_COUNT }, () => {
    const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

// Users may type lowercase, spaces or no dash; all of these should match.
export function normalizeCode(code) {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// scrypt is deliberately slow, so a leaked table cannot be brute-forced quickly.
export async function hashCode(code) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(normalizeCode(code), salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function matchesHash(code, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(normalizeCode(code), Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
