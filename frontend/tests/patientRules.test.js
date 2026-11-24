import { describe, expect, it } from "vitest";
import {
  adaptationInfo,
  earSideLabel,
  initials,
  looksLikeNationalId,
  noteInputError,
  patientInputError,
  patientsHref,
  phoneSearchDigits,
  readPatientQuery,
  searchTerm,
  splitPhone,
  statusLabel,
  whatsappGreeting,
} from "../src/modules/hastalar/patientRules";

describe("readPatientQuery and patientsHref", () => {
  it("falls back to the defaults for unknown values", () => {
    expect(readPatientQuery({ sekme: "x", gorunum: "y", ac: "-3" })).toEqual({ sekme: "tum", ara: null, gorunum: "tablo", ac: null });
  });

  it("reads the home page's card link", () => {
    expect(readPatientQuery({ ac: "42" }).ac).toBe(42);
  });

  it("leaves defaults out of the address", () => {
    const query = readPatientQuery({ sekme: "aday", ara: " Ayşe ", gorunum: "kart" });
    expect(patientsHref(query)).toBe("/hastalar?sekme=aday&ara=Ay%C5%9Fe&gorunum=kart");
    expect(patientsHref(query, { sekme: "tum", ara: null, gorunum: "tablo" })).toBe("/hastalar");
    expect(patientsHref(query, { ac: 7 })).toContain("ac=7");
  });
});

describe("search helpers", () => {
  it("removes PostgREST syntax from the search text", () => {
    expect(searchTerm("Ahmet, (Yılmaz)*")).toBe("Ahmet Yılmaz");
    expect(searchTerm("   ")).toBe("");
  });

  it("searches phones without spaces and the trunk zero", () => {
    expect(phoneSearchDigits("0532 123 45 67")).toBe("5321234567");
    expect(phoneSearchDigits("Ayşe")).toBeNull();
    expect(phoneSearchDigits("05")).toBeNull();
  });
});

describe("adaptationInfo", () => {
  it("counts down the 45 days", () => {
    const info = adaptationInfo("2026-11-01", "2026-11-21");
    expect(info).toMatchObject({ state: "active", end: "2026-12-16", daysLeft: 25, progress: 44 });
  });

  it("is done on day 45 and waiting before the start", () => {
    expect(adaptationInfo("2026-10-07", "2026-11-21").state).toBe("done");
    expect(adaptationInfo("2026-11-25", "2026-11-21").state).toBe("waiting");
  });

  it("returns null without a start date", () => {
    expect(adaptationInfo(null, "2026-11-21")).toBeNull();
  });
});

describe("labels", () => {
  it("names every overview status in Turkish", () => {
    expect(statusLabel("adaptation").label).toBe("Adaptasyon sürecinde");
    expect(statusLabel("warranty_expired").tone).toBe("danger");
    expect(statusLabel("unknown").label).toBe("Yeni kayıt");
  });

  it("uses Turkish capitals for initials", () => {
    expect(initials("ismail çelik")).toBe("İÇ");
    expect(initials("  ")).toBe("?");
  });

  it("names ear sides", () => {
    expect(earSideLabel("both")).toBe("İki kulak");
    expect(earSideLabel("none")).toBeNull();
  });

  it("writes the WhatsApp greeting", () => {
    expect(whatsappGreeting("Ayşe Kaya")).toBe("Merhaba Ayşe Kaya, Şelale İşitme'den sizinle iletişime geçiyoruz.");
  });
});

describe("splitPhone", () => {
  it("splits on the longest country code", () => {
    expect(splitPhone("+905321234567")).toEqual({ country: "+90", number: "5321234567" });
    expect(splitPhone("+994501234567")).toEqual({ country: "+994", number: "501234567" });
    expect(splitPhone(null)).toEqual({ country: "+90", number: "" });
  });
});

describe("patientInputError", () => {
  const valid = { fullName: "Ayşe Kaya", phone: "+905321234567" };

  it("accepts name and phone alone", () => {
    expect(patientInputError(valid, "2026-11-21")).toBeNull();
  });

  it("needs a name and a valid phone", () => {
    expect(patientInputError({ ...valid, fullName: " " })).toMatch(/Ad soyad/);
    expect(patientInputError({ ...valid, phone: "" })).toMatch(/telefon/);
  });

  it("checks the birth date", () => {
    expect(patientInputError({ ...valid, birthDate: "2027-01-01" }, "2026-11-21")).toMatch(/bugünden sonra/);
    expect(patientInputError({ ...valid, birthDate: "2026-02-30" }, "2026-11-21")).toMatch(/kontrol/);
  });

  it("checks the TC number", () => {
    expect(looksLikeNationalId("10000000146")).toBe(true);
    expect(patientInputError({ ...valid, nationalId: "12345678901" })).toMatch(/TC/);
    expect(patientInputError({ ...valid, nationalId: "10000000146" })).toBeNull();
  });
});

describe("noteInputError", () => {
  it("needs a title and a body", () => {
    expect(noteInputError({ title: "", body: "x" })).toMatch(/başlığını/);
    expect(noteInputError({ title: "Kontrol", body: " " })).toMatch(/Notu yazın/);
    expect(noteInputError({ title: "Kontrol", body: "İyi" })).toBeNull();
  });
});
