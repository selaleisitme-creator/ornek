import { describe, expect, it } from "vitest";
import { buildRefundArgs, buildSoldInfo, matchesSoldSearch, missingInfo, refundGuidance } from "@/modules/satis/refundRules";

const today = "2026-11-24";
const device = { saleItemId: 11, value: 30000, saleDate: "2026-11-01", isDevice: true, serial: "SN-1", refunded: false };

describe("refund", () => {
  it("builds the create_refund arguments", () => {
    expect(buildRefundArgs({ amount: 30000, method: "card_pos", reason: " memnun değil " }, { item: device, today })).toEqual({
      args: { saleItemId: 11, amount: 30000, method: "card_pos", reason: "memnun değil", returnsDevice: true, refundedOn: today },
    });
    expect(buildRefundArgs({ amount: 100, method: "cash", returnsDevice: false }, { item: device, today }).args.returnsDevice).toBe(false);
    const service = { saleItemId: 12, value: 500, saleDate: "2026-11-01", isDevice: false, serial: null };
    expect(buildRefundArgs({ amount: 500, method: "cash" }, { item: service, today }).args.returnsDevice).toBe(false);
  });

  it("refuses what the database would refuse", () => {
    expect(buildRefundArgs({ amount: 1, method: "cash" }, { item: null, today }).error).toMatch(/seçin/);
    expect(buildRefundArgs({ amount: 1, method: "cash" }, { item: { ...device, refunded: true }, today }).error).toMatch(/zaten/);
    expect(buildRefundArgs({ amount: 1, method: "cash" }, { item: { ...device, legacy: true }, today }).error).toMatch(/Panel öncesi/);
    expect(buildRefundArgs({ amount: 0, method: "cash" }, { item: device, today }).error).toMatch(/Geçerli/);
    expect(buildRefundArgs({ amount: 30000.01, method: "cash" }, { item: device, today }).error).toMatch(/büyük olamaz/);
    expect(buildRefundArgs({ amount: 1 }, { item: device, today }).error).toMatch(/ödeme şeklini/);
    expect(buildRefundArgs({ amount: 1, method: "cash", refundedOn: "2026-11-25" }, { item: device, today }).error).toMatch(/bugünden sonra/);
    expect(buildRefundArgs({ amount: 1, method: "cash", refundedOn: "2026-10-01" }, { item: device, today }).error).toMatch(/satış tarihinden önce/);
  });

  it("tells how the money goes back", () => {
    expect(refundGuidance("card_pos", "100,00 TL")).toBe("POS cihazından 100,00 TL iade edin.");
    expect(refundGuidance("cash", "100,00 TL")).toMatch(/geri verin/);
  });
});

describe("sold items", () => {
  it("lists the post-sale information a device still lacks", () => {
    expect(missingInfo({ isDevice: true, utsNo: "U1", productionDate: null, wsaCode: "" })).toEqual(["ÜRT tarihi", "WSA kodu"]);
    expect(missingInfo({ isDevice: false })).toEqual([]);
  });

  it("asks a label-less brand for its ÜTS number only", () => {
    expect(missingInfo({ isDevice: true, brand: "COSELGI", utsNo: "", productionDate: null, wsaCode: null })).toEqual(["ÜTS no"]);
    expect(missingInfo({ isDevice: true, brand: "Coselgi", utsNo: "U1" })).toEqual([]);
  });

  it("checks the post-sale information", () => {
    expect(buildSoldInfo({ productionDate: "2025-05-01", wsaCode: " W-1 ", utsNo: " U-1 " }, { item: device })).toEqual({
      unit: { production_date: "2025-05-01", wsa_code: "W-1" },
      utsNo: "U-1",
    });
    expect(buildSoldInfo({ productionDate: "2026-12-01" }, { item: device }).error).toMatch(/ÜRT/);
  });

  it("searches product, serial, buyer and sale number", () => {
    const item = { product: "Bernafon Alpha 5", serial: "SL-63001", buyer: "Ayşe Yılmaz", saleNo: "S00012" };
    expect(matchesSoldSearch(item, "alpha ayşe")).toBe(true);
    expect(matchesSoldSearch(item, "s00012")).toBe(true);
    expect(matchesSoldSearch(item, "connexx")).toBe(false);
    expect(matchesSoldSearch(item, "")).toBe(true);
  });
});
