import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyInput, parseMoney } from "@/lib/money";
import { formatDate, formatDateTime, parseDisplayDate, todayInClinic } from "@/lib/dates";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { normalizeGtin, parseScan } from "@/lib/gs1";
import { whatsappLink } from "@/lib/whatsapp";
import { toUserMessage } from "@/lib/postgresErrors";
import { missingPasswordRules } from "@/lib/passwordRules";
import { formatIdleCookie, isIdleExpired } from "@/lib/idleSession";

describe("idle sign-out cookie", () => {
  const start = Date.UTC(2026, 10, 9, 8, 0);
  const minute = 60 * 1000;

  it("signs out only after the limit has passed", () => {
    const cookie = formatIdleCookie("sess-1", 30, start);
    expect(isIdleExpired(cookie, "sess-1", start + 29 * minute)).toBe(false);
    expect(isIdleExpired(cookie, "sess-1", start + 31 * minute)).toBe(true);
  });

  it("never throws out a new login that still carries an old cookie", () => {
    const old = formatIdleCookie("sess-old", 30, start);
    expect(isIdleExpired(old, "sess-new", start + 600 * minute)).toBe(false);
  });

  it("ignores a missing or broken cookie and caps a tampered limit at 8 hours", () => {
    expect(isIdleExpired(undefined, "sess-1")).toBe(false);
    expect(isIdleExpired("garbage", "sess-1")).toBe(false);
    const tampered = formatIdleCookie("sess-1", 999999, start);
    expect(isIdleExpired(tampered, "sess-1", start + 481 * minute)).toBe(true);
  });
});

describe("password rules", () => {
  it("lists exactly what a password still misses", () => {
    expect(missingPasswordRules("Selale2026x")).toEqual([]);
    expect(missingPasswordRules("selale2026x")).toEqual(["Bir büyük harf"]);
    expect(missingPasswordRules("Kısa1")).toEqual(["En az 10 karakter"]);
    expect(missingPasswordRules("ŞELALEİŞİTME")).toEqual(["Bir küçük harf", "Bir rakam"]);
  });
});

describe("money", () => {
  it("reads the clinic's way of writing amounts", () => {
    expect(parseMoney("7.491,64")).toBe(7491.64);
    expect(parseMoney("20.000")).toBe(20000);
    expect(parseMoney("12500,5 TL")).toBe(12500.5);
    expect(parseMoney("0,1")).toBe(0.1);
    expect(parseMoney("-0,50")).toBe(-0.5);
  });

  it("refuses text that is not an amount instead of guessing", () => {
    expect(parseMoney("12,345")).toBeNull(); // three kuruş digits
    expect(parseMoney("1.23")).toBeNull(); // dot is not a decimal separator here
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });

  it("formats amounts, including numeric strings from the database", () => {
    expect(formatMoney(7491.64)).toBe("7.491,64 TL");
    expect(formatMoney("30000")).toBe("30.000,00 TL");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoneyInput(20000)).toBe("20.000,00");
  });
});

describe("dates", () => {
  it("uses Istanbul time for today", () => {
    // 22:30 UTC on 8 November is already 9 November in Istanbul (UTC+3).
    expect(todayInClinic(new Date("2026-11-08T22:30:00Z"))).toBe("2026-11-09");
  });

  it("formats and parses Turkish dates", () => {
    expect(formatDate("2026-11-09")).toBe("09.11.2026");
    expect(formatDateTime("2026-11-09T11:30:00Z")).toBe("09.11.2026 14:30");
    expect(parseDisplayDate("9.11.2026")).toBe("2026-11-09");
    expect(parseDisplayDate("31.02.2026")).toBeNull();
  });
});

describe("phone", () => {
  it("stores every number in one international shape", () => {
    expect(normalizePhone("+90", "0532 123 45 67")).toBe("+905321234567");
    expect(normalizePhone("+90", "5321234567")).toBe("+905321234567");
    expect(normalizePhone("+90", "+90 532 123 45 67")).toBe("+905321234567");
    expect(normalizePhone("+49", "0151 2345 6789")).toBe("+4915123456789");
  });

  it("rejects numbers that cannot be real", () => {
    expect(normalizePhone("+90", "532 123")).toBeNull();
    expect(normalizePhone("+90", "")).toBeNull();
  });

  it("formats Turkish numbers for reading", () => {
    expect(formatPhone("+905321234567")).toBe("+90 532 123 45 67");
  });
});

describe("GS1 barcodes", () => {
  it("reads bracketed scans", () => {
    expect(parseScan("(01)05714464091134(21)B78KFP(11)240501")).toEqual({
      gtin: "5714464091134",
      serial: "B78KFP",
      lot: null,
      productionDate: "2024-05-01",
      expiryDate: null,
    });
  });

  it("reads raw scans separated by the GS character", () => {
    const gs = String.fromCharCode(29);
    expect(parseScan(`0105714464091134` + `21CGC0720${gs}11240501`)).toMatchObject({
      gtin: "5714464091134",
      serial: "CGC0720",
      productionDate: "2024-05-01",
    });
  });

  it("passes anything else through as raw text", () => {
    expect(parseScan("B6GFLV")).toEqual({ raw: "B6GFLV" });
    expect(parseScan("  ")).toEqual({ raw: "" });
  });

  it("treats GTIN-14 with a leading zero as the EAN-13", () => {
    expect(normalizeGtin("05714464056637")).toBe("5714464056637");
    expect(normalizeGtin("5714464056637")).toBe("5714464056637");
  });
});

describe("whatsapp", () => {
  it("builds a draft link", () => {
    expect(whatsappLink("+905321234567", "Merhaba Ali Bey")).toBe("https://wa.me/905321234567?text=Merhaba%20Ali%20Bey");
    expect(whatsappLink("")).toBeNull();
  });

  it("builds a WhatsApp Web link for computers", () => {
    expect(whatsappLink("+905321234567", "Merhaba Ali Bey", { web: true })).toBe(
      "https://web.whatsapp.com/send?phone=905321234567&text=Merhaba%20Ali%20Bey"
    );
    expect(whatsappLink("+905321234567", "", { web: true })).toBe("https://web.whatsapp.com/send?phone=905321234567");
  });
});

describe("database errors", () => {
  it("turns known database messages into Turkish", () => {
    expect(toUserMessage({ message: "Stock unit 4 is not in stock" })).toMatch(/stokta değil/);
    expect(toUserMessage({ message: 'conflicting key value violates exclusion constraint "appointments_no_overlap"' })).toMatch(/başka bir randevu/);
    expect(toUserMessage({ code: "23505", message: "duplicate key" })).toMatch(/zaten var/);
  });

  it("never shows an unknown database message", () => {
    expect(toUserMessage({ message: "relation public.secret_table does not exist" })).toBe("İşlem tamamlanamadı. Lütfen tekrar deneyin.");
  });
});
