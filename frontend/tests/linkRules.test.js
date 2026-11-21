import { describe, expect, it } from "vitest";
import { LINK_COLORS, isSystemLink, linkInputError, linkLetter, nextLinkColor, normalizeUrl } from "../src/modules/baglantilar/linkRules";

describe("normalizeUrl", () => {
  it("adds https when the scheme is missing and keeps empty addresses empty", () => {
    expect(normalizeUrl("kolaysoft.com.tr")).toBe("https://kolaysoft.com.tr");
    expect(normalizeUrl("  http://site.com/a ")).toBe("http://site.com/a");
    expect(normalizeUrl("   ")).toBe("");
  });
});

describe("linkInputError", () => {
  it("needs a name", () => {
    expect(linkInputError({ name: "  ", url: "" })).toMatch(/adını/);
  });

  it("accepts a link without an address", () => {
    expect(linkInputError({ name: "Medula", url: "" })).toBeNull();
  });

  it("accepts a normal address with or without the scheme", () => {
    expect(linkInputError({ name: "Paynet", url: "www.paynet.com.tr" })).toBeNull();
    expect(linkInputError({ name: "Paynet", url: "https://www.paynet.com.tr/" })).toBeNull();
  });

  it("refuses addresses that are not web pages", () => {
    expect(linkInputError({ name: "X", url: "javascript:alert(1)" })).toMatch(/Geçerli/);
    expect(linkInputError({ name: "X", url: "localhost" })).toMatch(/Geçerli/);
    expect(linkInputError({ name: "X", url: "bir şey yazdım" })).toMatch(/Geçerli/);
  });
});

describe("tiles", () => {
  it("takes the first letter in Turkish capitals", () => {
    expect(linkLetter("işitme portalı")).toBe("İ");
    expect(linkLetter("E-mail")).toBe("E");
    expect(linkLetter("@@")).toBe("@");
  });

  it("cycles the design colours", () => {
    expect(nextLinkColor(0)).toBe(LINK_COLORS[0]);
    expect(nextLinkColor(5)).toBe(LINK_COLORS[1]);
  });

  it("knows the system links", () => {
    expect(isSystemLink({ system_key: "kolaysoft" })).toBe(true);
    expect(isSystemLink({ systemKey: null })).toBe(false);
  });
});
