import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// National ID (TC kimlik no) encryption. The key lives only in the server environment (NATIONAL_ID_KEY,
// 32 random bytes in base64); the database stores ciphertext it cannot read. Losing the key makes every
// stored ID unreadable, so it must be kept somewhere safe besides Vercel and .env.local.
//
// AES-256-GCM: besides hiding the number it detects tampering, so a changed ciphertext fails to decrypt
// instead of producing a wrong ID. Stored as "v1:" + base64(iv | tag | ciphertext); the version prefix
// lets a future key rotation tell old and new values apart.

const VERSION = "v1";

function loadKey() {
  const key = Buffer.from(process.env.NATIONAL_ID_KEY ?? "", "base64");
  if (key.length !== 32) {
    throw new Error("NATIONAL_ID_KEY is missing or is not 32 bytes of base64");
  }
  return key;
}

// Official TC kimlik checksum: 11 digits, no leading zero, digits 10 and 11 are derived from the first nine.
export function isValidNationalId(value) {
  const id = String(value ?? "");
  if (!/^[1-9]\d{10}$/.test(id)) return false;
  const d = id.split("").map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = d.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10;
  return d[9] === tenth && d[10] === eleventh;
}

export function encryptNationalId(value) {
  const id = String(value ?? "");
  if (!isValidNationalId(id)) throw new Error("Invalid national ID");

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), iv);
  const encrypted = Buffer.concat([cipher.update(id, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: `${VERSION}:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`,
    last4: id.slice(-4),
  };
}

export function decryptNationalId(stored) {
  const [version, payload] = String(stored ?? "").split(":");
  if (version !== VERSION || !payload) throw new Error("Unknown national ID format");

  const data = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

// For the screen: "*******1234".
export function maskNationalId(last4) {
  return last4 ? `*******${last4}` : "—";
}
