import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptNationalId, encryptNationalId, isValidNationalId, maskNationalId } from "@/lib/nationalId";

// 10000000146 is a well-known test number that passes the official TC checksum (not a real person).
const VALID = "10000000146";

beforeAll(() => {
  process.env.NATIONAL_ID_KEY = randomBytes(32).toString("base64"); // throwaway key for this test run only
});

describe("national ID", () => {
  it("checks the official checksum", () => {
    expect(isValidNationalId(VALID)).toBe(true);
    expect(isValidNationalId("10000000147")).toBe(false); // wrong last digit
    expect(isValidNationalId("01234567890")).toBe(false); // may not start with 0
    expect(isValidNationalId("1234")).toBe(false);
  });

  it("encrypts so the database never sees the number, and decrypts it back", () => {
    const { encrypted, last4 } = encryptNationalId(VALID);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted).not.toContain(VALID);
    expect(last4).toBe("0146");
    expect(decryptNationalId(encrypted)).toBe(VALID);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptNationalId(VALID).encrypted).not.toBe(encryptNationalId(VALID).encrypted);
  });

  it("refuses a tampered value instead of returning a wrong number", () => {
    const { encrypted } = encryptNationalId(VALID);
    const bytes = Buffer.from(encrypted.slice(3), "base64");
    bytes[bytes.length - 1] ^= 1;
    expect(() => decryptNationalId(`v1:${bytes.toString("base64")}`)).toThrow();
  });

  it("refuses an invalid number and a missing key", () => {
    expect(() => encryptNationalId("12345678901")).toThrow(/Invalid/);
    const saved = process.env.NATIONAL_ID_KEY;
    process.env.NATIONAL_ID_KEY = "";
    expect(() => encryptNationalId(VALID)).toThrow(/NATIONAL_ID_KEY/);
    process.env.NATIONAL_ID_KEY = saved;
  });

  it("masks for display", () => {
    expect(maskNationalId("0146")).toBe("*******0146");
  });
});
