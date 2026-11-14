import { describe, expect, it } from "vitest";
import {
  STOCK_GROUPS,
  brandHeading,
  collapseUnits,
  countEarSides,
  earSideLabel,
  formatEarSides,
  formatStock,
  groupByBrand,
  hasEarSides,
  matchesAllWords,
  readStockQuery,
  receiptLabel,
  scanToSearchText,
  searchTerms,
  searchWords,
  stockGroupByCategory,
  stockGroupByKey,
  stockHref,
  stockLevelInfo,
  summarizeAlerts,
  splitTotalCost,
  packsFromPackaging,
  cleanGtin,
  sameGtin,
  findDuplicateSerial,
  defaultSerialPolicy,
  serialPolicyLabel,
  newModelError,
  entryError,
  buildStockEntryArgs,
  modelFieldsError,
  buildModelUpdate,
  serialRuleWarning,
  buildUnitUpdate,
  purchasePriceError,
  photoFileError,
  MAX_PHOTO_BYTES,
  buildRemovalArgs,
  cleanUnitIds,
  pickedUnitIds,
  rowBySerial,
  computeNewPrice,
  previewPriceChange,
  parsePriceValue,
  priceChangeError,
  buildBulkPriceArgs,
  priceBatchLabel,
  buildServiceItem,
  serviceCategoryLabel,
} from "@/modules/stok/stockRules";

describe("stock entry rules", () => {
  it("splits a total like the database: remainder on the last unit, sum unchanged", () => {
    const prices = splitTotalCost(30000, 7);
    expect(prices).toEqual([4285.71, 4285.71, 4285.71, 4285.71, 4285.71, 4285.71, 4285.74]);
    expect(Math.round(prices.reduce((a, b) => a + b, 0) * 100)).toBe(3000000);
    expect(splitTotalCost(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(splitTotalCost(0.05, 2)).toEqual([0.03, 0.02]); // round half up like Postgres round()
    expect(splitTotalCost(500, 1)).toEqual([500]);
    expect(splitTotalCost(100, 0)).toEqual([]);
  });

  it("counts battery packs from cartons and boxes", () => {
    expect(packsFromPackaging({ cartons: 2, boxes: 3, packs: 4 }, { packsPerBox: 10, boxesPerCarton: 6 })).toBe(154);
    expect(packsFromPackaging({ packs: 5 }, {})).toBe(5);
    expect(packsFromPackaging({ boxes: 1 }, {})).toBeNull();
    expect(packsFromPackaging({ cartons: 1 }, { packsPerBox: 10 })).toBeNull();
  });

  it("cleans GTINs and compares the 13 and 14 digit forms", () => {
    expect(cleanGtin("05714464091134")).toEqual({ gtin: "5714464091134", error: null });
    expect(cleanGtin(" ")).toEqual({ gtin: null, error: null });
    expect(cleanGtin("57A44").error).toMatch(/rakam/);
    expect(cleanGtin("1234567").error).toMatch(/8 ile 14/);
    expect(sameGtin("05714464091134", "5714464091134")).toBe(true);
    expect(sameGtin("5714464091134", null)).toBe(false);
  });

  it("finds a repeated serial and labels the serial rules", () => {
    expect(findDuplicateSerial(["A1", " B2", "", "", "B2 "])).toBe("B2");
    expect(findDuplicateSerial(["A1", "", ""])).toBeNull();
    expect(defaultSerialPolicy("device")).toBe("required");
    expect(defaultSerialPolicy("battery")).toBe("required");
    expect(defaultSerialPolicy("dome")).toBe("none");
    expect(serialPolicyLabel("optional")).toBe("İsteğe bağlı");
  });

  const goodModel = { brandId: 3, category: "device", name: "Viron 9", salePrice: 45000, serialPolicy: "required" };

  it("checks a new model", () => {
    expect(newModelError(goodModel)).toBeNull();
    expect(newModelError({ ...goodModel, brandId: null })).toMatch(/Marka/);
    expect(newModelError({ ...goodModel, name: "  " })).toMatch(/Model adı/);
    expect(newModelError({ ...goodModel, salePrice: 0 })).toMatch(/Satış fiyatı/);
    expect(newModelError({ ...goodModel, gtin: "12" })).toMatch(/GTIN/);
    expect(newModelError({ ...goodModel, category: "battery" })).toMatch(/pil adedini/);
    expect(newModelError({ ...goodModel, category: "battery", packSize: 6 })).toBeNull();
  });

  const purchase = { opening: false, priceMode: "unit", amount: 1000, paymentMethod: "cash", receivedOn: "2026-11-14", today: "2026-11-14" };

  it("checks the entry step", () => {
    const units = [{ serialNo: "A1" }, { serialNo: "A2" }];
    expect(entryError({ ...purchase, units, serialPolicy: "required" })).toBeNull();
    expect(entryError({ ...purchase, units: [], serialPolicy: "required" })).toMatch(/1 ile 500/);
    expect(entryError({ ...purchase, units: [{ serialNo: "A1" }, { serialNo: "" }], serialPolicy: "required" })).toMatch(/2\. satır/);
    expect(entryError({ ...purchase, units, serialPolicy: "none" })).toMatch(/seri numarasız/);
    expect(entryError({ ...purchase, units: [{ serialNo: "A1" }, { serialNo: "A1" }], serialPolicy: "optional" })).toMatch(/iki kez/);
    expect(entryError({ ...purchase, units, serialPolicy: "required", amount: null })).toMatch(/sıfırdan büyük/);
    expect(entryError({ ...purchase, units, serialPolicy: "required", paymentMethod: null })).toMatch(/ödeme şeklini/);
    expect(entryError({ ...purchase, units, serialPolicy: "required", receivedOn: "2026-11-15" })).toMatch(/bugünden sonra/);
    expect(entryError({ ...purchase, units, serialPolicy: "required", opening: true, amount: null, paymentMethod: null })).toBeNull();
    expect(entryError({ ...purchase, units, serialPolicy: "required", amount: Number.NaN })).toMatch(/geçersiz/);
  });

  it("builds the RPC arguments for two serial devices bought as one total", () => {
    const built = buildStockEntryArgs(
      {
        product: { ...goodModel, type: "RIC", gtin: "05714464091134", warrantyMonths: "24", minStock: "" },
        receipt: { opening: false, supplierId: 5, receivedOn: "2026-11-14", invoiceNo: " F-123 ", paymentMethod: "transfer", note: "", priceMode: "total", amount: 30000.01 },
        units: [
          { serialNo: "SN1", earSide: "right", productionDate: "2024-05-01" },
          { serialNo: " SN2 ", earSide: "left", productionDate: "" },
        ],
      },
      { today: "2026-11-14" }
    );
    expect(built.error).toBeUndefined();
    expect(built.args.product).toMatchObject({ brand_id: 3, category: "device", gtin: "5714464091134", unit: "piece", purchase_price: 15000.01, warranty_months: 24, min_stock: 0, serial_policy: "required" });
    expect(built.args.receipt).toEqual({
      opening: false, supplier_id: 5, received_on: "2026-11-14", invoice_no: "F-123", payment_method: "transfer", note: null, price_mode: "total", amount: 30000.01,
    });
    expect(built.args.units[1]).toEqual({ serial_no: "SN2", ear_side: "left", production_date: null, wsa_code: null });
  });

  it("builds opening stock for serial-less receivers and trusts the database serial rule", () => {
    const units = Array.from({ length: 8 }, () => ({ serialNo: "", earSide: "both", productionDate: "" }));
    const existing = { id: 17, category: "receiver", unit: "piece", serial_policy: "none", active: true };
    const built = buildStockEntryArgs(
      { product: { id: 17, serialPolicy: "required" }, receipt: { opening: true, priceMode: "unit", amount: null, paymentMethod: "cash", supplierId: 2 }, units },
      { existing, today: "2026-11-14" }
    );
    expect(built.args.product).toEqual({ id: 17 });
    expect(built.args.receipt).toEqual({
      opening: true, supplier_id: null, received_on: null, invoice_no: null, payment_method: null, note: null, price_mode: "unit", amount: null,
    });
    expect(built.args.units).toHaveLength(8);
    expect(built.args.units[0]).toEqual({ serial_no: null, ear_side: "both", production_date: null, wsa_code: null });

    const withSerial = buildStockEntryArgs({ product: { id: 17 }, receipt: { opening: true, priceMode: "unit" }, units: [{ serialNo: "X" }] }, { existing, today: "2026-11-14" });
    expect(withSerial.error).toMatch(/seri numarasız/);
  });

  it("drops the ear side outside devices and receivers, and refuses unknown payment methods", () => {
    const existing = { id: 9, category: "charger", unit: "piece", serial_policy: "optional", active: true };
    const base = { product: { id: 9 }, receipt: { opening: false, priceMode: "unit", amount: 100, paymentMethod: "cash", receivedOn: "2026-11-01" } };
    expect(buildStockEntryArgs({ ...base, units: [{ serialNo: "", earSide: "right" }] }, { existing, today: "2026-11-14" }).args.units[0].ear_side).toBeNull();
    expect(buildStockEntryArgs({ ...base, receipt: { ...base.receipt, paymentMethod: "paynet" }, units: [{}] }, { existing, today: "2026-11-14" }).error).toMatch(/ödeme/);
  });
});

describe("stock groups", () => {
  it("maps URL keys and database categories both ways", () => {
    expect(STOCK_GROUPS.map((group) => group.key)).toEqual(["cihaz", "receiver", "sarj", "pil", "dome"]);
    expect(stockGroupByKey("pil")).toMatchObject({ category: "battery", label: "Piller" });
    expect(stockGroupByKey("sarj").category).toBe("charger");
    expect(stockGroupByCategory("dome").key).toBe("dome");
  });

  it("falls back to hearing aids for an unknown key", () => {
    expect(stockGroupByKey("yok").key).toBe("cihaz");
    expect(stockGroupByKey(undefined).label).toBe("İşitme cihazları");
  });

  it("shows ear sides only for devices and receivers", () => {
    expect(hasEarSides("device")).toBe(true);
    expect(hasEarSides("receiver")).toBe(true);
    expect(hasEarSides("battery")).toBe(false);
  });
});

describe("ear sides", () => {
  it("names every side, and an empty one as not specified", () => {
    expect(earSideLabel("right")).toBe("Sağ");
    expect(earSideLabel("left")).toBe("Sol");
    expect(earSideLabel("both")).toBe("İki kulak");
    expect(earSideLabel("none")).toBe("Taraf yok");
    expect(earSideLabel(null)).toBe("Belirtilmedi");
  });

  it("counts and formats only the sides that have units", () => {
    const counts = countEarSides(["right", "right", "left", null, "none"]);
    expect(counts).toEqual({ right: 2, left: 1, both: 0 });
    expect(formatEarSides(counts)).toBe("Sağ 2 · Sol 1");
    expect(formatEarSides({ right: 0, left: 0, both: 3 })).toBe("İki kulak 3");
    expect(formatEarSides(countEarSides([]))).toBe("");
  });
});

describe("stock level and stock cell", () => {
  it("gives each level its label and tone", () => {
    expect(stockLevelInfo("ok")).toEqual({ label: "Stokta", tone: "ok" });
    expect(stockLevelInfo("low")).toEqual({ label: "Azalıyor", tone: "warn" });
    expect(stockLevelInfo("out")).toEqual({ label: "Bitti", tone: "danger" });
  });

  it("counts pieces in adet", () => {
    expect(formatStock({ unit: "piece", inStock: 3 })).toBe("3 adet");
    expect(formatStock({ unit: "piece", inStock: 0 })).toBe("0 adet");
  });

  it("shows batteries as packs, whole boxes and cartons, and the battery total", () => {
    expect(formatStock({ unit: "pack", inStock: 24, boxes: 4, cartons: 0, totalBatteries: 144 })).toBe("24 paket · 4 kutu · 144 pil");
    expect(formatStock({ unit: "pack", inStock: 120, boxes: 20, cartons: 2, totalBatteries: 720 })).toBe(
      "120 paket · 20 kutu · 2 koli · 720 pil"
    );
    expect(formatStock({ unit: "pack", inStock: 5, boxes: null, cartons: null, totalBatteries: 30 })).toBe("5 paket · 30 pil");
  });
});

describe("grouping by brand", () => {
  const models = [
    { productId: 1, brandId: 10, brandName: "Bernafon", category: "device", inStock: 3 },
    { productId: 2, brandId: 10, brandName: "Bernafon", category: "device", inStock: 10 },
    { productId: 3, brandId: 20, brandName: "Coselgi", category: "device", inStock: 0 },
  ];

  it("keeps the incoming order and totals models and units", () => {
    const groups = groupByBrand(models);
    expect(groups.map((group) => group.brandName)).toEqual(["Bernafon", "Coselgi"]);
    expect(groups[0]).toMatchObject({ modelCount: 2, unitCount: 13 });
    expect(brandHeading(groups[0])).toBe("Bernafon · 2 model · 13 cihaz");
    expect(brandHeading(groups[1])).toBe("Coselgi · 1 model · 0 cihaz");
  });

  it("uses the group's word, and adet when a search mixes groups", () => {
    const [batteries] = groupByBrand([{ productId: 4, brandId: 30, brandName: "Rayovac", category: "battery", inStock: 24 }]);
    expect(brandHeading(batteries)).toBe("Rayovac · 1 model · 24 paket");
    const [mixed] = groupByBrand([
      { productId: 5, brandId: 10, brandName: "Bernafon", category: "device", inStock: 1 },
      { productId: 6, brandId: 10, brandName: "Bernafon", category: "receiver", inStock: 4 },
    ]);
    expect(brandHeading(mixed)).toBe("Bernafon · 2 model · 5 adet");
  });
});

describe("alerts", () => {
  it("counts out and low models", () => {
    const summary = summarizeAlerts([{ stockLevel: "out" }, { stockLevel: "out" }, { stockLevel: "low" }]);
    expect(summary.out).toBe(2);
    expect(summary.low).toBe(1);
    expect(summary.items).toHaveLength(3);
  });
});

describe("unit rows", () => {
  const unit = (id, extra) => ({ id, serialNo: null, receiptId: 1, earSide: null, purchasePrice: "100.00", ...extra });

  it("merges serial-less units with the same receipt, side and price", () => {
    const rows = collapseUnits([unit(1), unit(2), unit(3, { earSide: "right" }), unit(4, { receiptId: 2 }), unit(5)]);
    expect(rows.map((row) => [row.id, row.count])).toEqual([
      [1, 3],
      [3, 1],
      [4, 1],
    ]);
  });

  it("keeps every serial-numbered unit on its own row", () => {
    const rows = collapseUnits([unit(1, { serialNo: "A1" }), unit(2, { serialNo: "A2" })]);
    expect(rows.map((row) => row.count)).toEqual([1, 1]);
  });

  it("keeps the ids of every merged unit, and a serial row its own id", () => {
    const rows = collapseUnits([unit(1), unit(2, { serialNo: "S2" }), unit(3), unit(4, { earSide: "left" }), unit(5)]);
    expect(rows.map((row) => row.unitIds)).toEqual([[1, 3, 5], [2], [4]]);
    expect(rows[0].count).toBe(rows[0].unitIds.length);
  });

  it("treats opening stock (no receipt) as one source", () => {
    const rows = collapseUnits([unit(1, { receiptId: null }), unit(2, { receiptId: null })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });

  it("labels where a unit came from", () => {
    expect(receiptLabel({ receiptId: null })).toBe("Açılış stoğu");
    expect(receiptLabel({ receiptId: 1, supplierName: "Bilgi Medikal", invoiceNo: "F-12" })).toBe("Bilgi Medikal · F-12");
    expect(receiptLabel({ receiptId: 1, supplierName: null, invoiceNo: "F-12" })).toBe("F-12");
    expect(receiptLabel({ receiptId: 1 })).toBe("—");
  });
});

describe("address bar", () => {
  it("reads options and ignores anything unexpected", () => {
    expect(readStockQuery({})).toEqual({ sekme: "stok", grup: "cihaz", marka: null, ara: null, gorunum: "tablo", ac: null });
    expect(readStockQuery({ grup: "pil", marka: "3", ara: "  Viron ", gorunum: "kart", ac: "17" })).toEqual({
      sekme: "stok",
      grup: "pil",
      marka: 3,
      ara: "Viron",
      gorunum: "kart",
      ac: 17,
    });
    expect(readStockQuery({ grup: "x", marka: "abc", gorunum: "liste", ac: "-1" })).toMatchObject({
      grup: "cihaz",
      marka: null,
      gorunum: "tablo",
      ac: null,
    });
    expect(readStockQuery({ ara: ["first", "second"] }).ara).toBe("first");
  });

  it("builds links that leave defaults out", () => {
    const query = readStockQuery({ grup: "receiver", ara: "abc" });
    expect(stockHref(query)).toBe("/stok?grup=receiver&ara=abc");
    expect(stockHref(query, { ac: 5 })).toBe("/stok?grup=receiver&ara=abc&ac=5");
    expect(stockHref(query, { ara: null, grup: "cihaz" })).toBe("/stok");
    expect(stockHref({}, { grup: "pil", ac: 9 })).toBe("/stok?grup=pil&ac=9");
    expect(stockHref({}, { ara: "(01)123(21)A B" })).toBe("/stok?ara=%2801%29123%2821%29A+B");
  });

  it("reads and writes the section", () => {
    expect(readStockQuery({ sekme: "servis" }).sekme).toBe("servis");
    expect(readStockQuery({ sekme: "satilan" }).sekme).toBe("stok");
    expect(stockHref({}, { sekme: "servis" })).toBe("/stok?sekme=servis");
    expect(stockHref(readStockQuery({ sekme: "stok", grup: "pil" }))).toBe("/stok?grup=pil");
  });
});

describe("bulk price rules", () => {
  it("computes like update_prices_bulk (exact decimals, halves away from zero)", () => {
    expect(computeNewPrice(18500, { mode: "percent", value: 7.5, roundTo: 10 })).toBe(19890); // 19887.5 → 19890
    expect(computeNewPrice(22500, { mode: "percent", value: -12, roundTo: 100 })).toBe(19800);
    expect(computeNewPrice(160, { mode: "amount", value: 2.5, roundTo: 0 })).toBe(162.5);
    expect(computeNewPrice(199.99, { mode: "percent", value: 10, roundTo: 1 })).toBe(220); // 219.989 → 220
    expect(computeNewPrice(18500, { mode: "percent", value: 7.5, roundTo: 0 })).toBe(19887.5);
    // Floats would give 15.07 here (15.075 is 15.07499… in binary); Postgres numeric gives 15.08.
    expect(computeNewPrice(10.05, { mode: "percent", value: 50, roundTo: 0 })).toBe(15.08);
    expect(computeNewPrice(100, { mode: "amount", value: 5, roundTo: 10 })).toBe(110); // 10.5 → 11
    expect(computeNewPrice("1250.00", { mode: "amount", value: -250.5, roundTo: 0 })).toBe(999.5);
  });

  it("sets a new price to the kuruş whatever the rounding", () => {
    expect(computeNewPrice(123, { mode: "set", value: 999.99, roundTo: 10 })).toBe(999.99);
    expect(computeNewPrice(123, { mode: "set", value: 1.234 })).toBeNull();
    expect(computeNewPrice(123, { mode: "percent", value: 5, roundTo: 5 })).toBeNull();
  });

  it("previews each model with its status and counts", () => {
    const models = [
      { id: 1, brandName: "Bernafon", name: "Alpha 5", salePrice: "18500.00" },
      { id: 2, brandName: "Bernafon", name: "Alpha 3", salePrice: 40 },
      { id: 3, brandName: "Coselgi", name: "Pil 312", salePrice: 19800 },
    ];
    const { rows, counts } = previewPriceChange(models, { mode: "percent", value: -12, roundTo: 100 });
    expect(rows.map((row) => [row.productId, row.oldPrice, row.newPrice, row.status])).toEqual([
      [1, 18500, 16300, "ok"],
      [2, 40, 0, "bad"], // 35.2 rounds to 0 at 100 TL
      [3, 19800, 17400, "ok"],
    ]);
    expect(counts).toEqual({ total: 3, ok: 2, same: 0, bad: 1 });

    const same = previewPriceChange([models[2]], { mode: "set", value: 19800 });
    expect(same.rows[0].status).toBe("same");
    expect(same.counts.same).toBe(1);

    const pending = previewPriceChange(models, { mode: "percent", value: null, roundTo: 0 });
    expect(pending.rows.every((row) => row.newPrice === null && row.status === null)).toBe(true);
    expect(pending.counts).toEqual({ total: 3, ok: 0, same: 0, bad: 0 });
  });

  it("reads the value box", () => {
    expect(parsePriceValue("percent", "7,5")).toBe(7.5);
    expect(parsePriceValue("percent", "-12")).toBe(-12);
    expect(parsePriceValue("percent", "+5 %")).toBe(5);
    expect(parsePriceValue("percent", "7,555")).toBeNull();
    expect(parsePriceValue("amount", "-1.250,50")).toBe(-1250.5);
    expect(parsePriceValue("amount", "+2,5")).toBe(2.5);
    expect(parsePriceValue("set", "20.000")).toBe(20000);
    expect(parsePriceValue("set", "-5")).toBeNull();
    expect(parsePriceValue("set", "")).toBeNull();
  });

  it("checks the change and builds the database arguments", () => {
    expect(priceChangeError({ mode: "x", value: 1, roundTo: 0 })).toMatch(/yöntemini/);
    expect(priceChangeError({ mode: "percent", value: null, roundTo: 0 })).toMatch(/7,5/);
    expect(priceChangeError({ mode: "percent", value: -100, roundTo: 0 })).toMatch(/-100 ile 1000/);
    expect(priceChangeError({ mode: "set", value: 0 })).toMatch(/sıfırdan büyük/);
    expect(priceChangeError({ mode: "amount", value: 10, roundTo: 5 })).toMatch(/Yuvarlama/);
    expect(priceChangeError({ mode: "amount", value: 1.005, roundTo: 0 })).toMatch(/iki ondalık/);
    expect(priceChangeError({ mode: "percent", value: 7.5, roundTo: 10 })).toBeNull();

    expect(buildBulkPriceArgs({ productIds: [3, "3", 5], mode: "percent", value: 7.5, roundTo: "10" })).toEqual({
      args: { productIds: [3, 5], mode: "percent", value: 7.5, roundTo: 10 },
    });
    expect(buildBulkPriceArgs({ productIds: [1], mode: "set", value: 100, roundTo: 100 }).args.roundTo).toBe(0);
    expect(buildBulkPriceArgs({ productIds: [], mode: "set", value: 100 }).error).toMatch(/modelleri seçin/);
    expect(buildBulkPriceArgs({ productIds: [1, "x"], mode: "set", value: 100 }).error).toMatch(/modelleri seçin/);
  });

  it("labels the last batch", () => {
    expect(priceBatchLabel({ changedAtText: "14.11.2026 15:10", count: 5, names: ["Alpha 5", "Alpha 3"] })).toBe(
      "Son fiyat güncellemesi: 14.11.2026 15:10 · 5 model (Alpha 5, Alpha 3 …)"
    );
    expect(priceBatchLabel({ changedAtText: "14.11.2026 15:10", count: 1, names: ["Alpha 5"] })).toBe(
      "Son fiyat güncellemesi: 14.11.2026 15:10 · 1 model (Alpha 5)"
    );
  });
});

describe("service price list rules", () => {
  it("checks a service item", () => {
    expect(buildServiceItem({ category: "service", name: "  Kalıp   ücreti ", price: 2000 }, { isNew: true })).toEqual({
      values: { name: "Kalıp ücreti", price: 2000, category: "service" },
    });
    expect(buildServiceItem({ name: "REM", price: 15000.555 }, { isNew: false })).toEqual({ values: { name: "REM", price: 15000.56 } });
    expect(buildServiceItem({ category: "service", name: " ", price: 1 }, { isNew: true }).error).toMatch(/adı zorunlu/);
    expect(buildServiceItem({ category: "service", name: "x".repeat(121), price: 1 }, { isNew: true }).error).toMatch(/120/);
    expect(buildServiceItem({ category: "service", name: "A", price: 0 }, { isNew: true }).error).toMatch(/sıfırdan büyük/);
    expect(buildServiceItem({ category: "service", name: "A", price: null }, { isNew: true }).error).toMatch(/biçiminde/);
    expect(buildServiceItem({ category: "other", name: "A", price: 1 }, { isNew: true }).error).toMatch(/Grubu/);
    expect(serviceCategoryLabel("audiology_exam")).toBe("Odyolojik Muayene");
  });
});

describe("search", () => {
  it("writes a GS1 scan back in bracket form", () => {
    expect(scanToSearchText({ gtin: "5714464091134", serial: "B78KFP" })).toBe("(01)5714464091134(21)B78KFP");
    expect(scanToSearchText({ gtin: "5714464091134", serial: null })).toBe("(01)5714464091134");
    expect(scanToSearchText({ raw: " Viron 9 " })).toBe("Viron 9");
  });

  it("splits a GS1 label into GTIN and serial", () => {
    expect(searchTerms("(01)05714464091134(21)B78KFP(11)240501")).toEqual({
      words: [],
      gtins: ["5714464091134", "05714464091134"],
      serial: "B78KFP",
    });
  });

  it("tries plain text as words and a serial, and digits as a barcode too", () => {
    expect(searchTerms("Bernafon Alpha")).toEqual({ words: ["bernafon", "alpha"], gtins: [], serial: "Bernafon Alpha" });
    expect(searchTerms("8690000000017")).toEqual({
      words: ["8690000000017"],
      gtins: ["8690000000017", "08690000000017"],
      serial: "8690000000017",
    });
    expect(searchTerms("   ")).toEqual({ words: [], gtins: [], serial: null });
  });

  it("splits text into folded words, once each", () => {
    expect(searchWords("  Bernafon   alpha ALPHA ")).toEqual(["bernafon", "alpha"]);
    expect(searchWords("VIRON")).toEqual(["viron"]);
    expect(searchWords("vıron")).toEqual(["viron"]);
    expect(searchWords("")).toEqual([]);
  });

  it("needs every word in the brand or model name, in any order", () => {
    const text = "Bernafon Alpha 5 MNR T";
    expect(matchesAllWords(text, searchWords("bernafon alpha"))).toBe(true);
    expect(matchesAllWords(text, searchWords("MNR bernafon"))).toBe(true);
    expect(matchesAllWords(text, searchWords("BERNAFON"))).toBe(true);
    expect(matchesAllWords(text, searchWords("bernafon viron"))).toBe(false);
    expect(matchesAllWords("Coselgi İşitme Pil", searchWords("IŞITME"))).toBe(true);
  });
});

describe("model editing", () => {
  const model = {
    name: " Viron  9 ",
    type: "",
    salePrice: 45000.456,
    gtin: "07612345678906",
    packageBarcode: "",
    manufacturerRef: "REF-1",
    warrantyMonths: "24",
    minStock: "",
    serialPolicy: "required",
    packSize: "",
    packsPerBox: "",
    boxesPerCarton: "",
  };

  it("shares the new-model checks except the brand", () => {
    expect(modelFieldsError({ ...model, category: "device" })).toBeNull();
    expect(modelFieldsError({ ...model, name: " ", category: "device" })).toMatch(/Model adı/);
    expect(modelFieldsError({ ...model, salePrice: 0, category: "device" })).toMatch(/Satış fiyatı/);
    expect(modelFieldsError({ ...model, gtin: "123", category: "device" })).toMatch(/8 ile 14/);
    expect(modelFieldsError({ ...model, minStock: "-1", category: "device" })).toMatch(/Alt stok/);
    expect(modelFieldsError({ ...model, category: "battery" })).toMatch(/pil adedini/);
    expect(modelFieldsError()).toMatch(/Model adı/);
  });

  it("builds only the columns this screen may change", () => {
    const { values } = buildModelUpdate(model, { category: "device" });
    expect(values).toEqual({
      name: "Viron 9",
      type: null,
      gtin: "7612345678906",
      package_barcode: null,
      manufacturer_ref: "REF-1",
      sale_price: 45000.46,
      warranty_months: 24,
      min_stock: 0,
      serial_policy: "required",
    });
    for (const column of ["category", "brand_id", "unit", "purchase_price", "active"]) expect(values).not.toHaveProperty(column);
  });

  it("writes the packaging only for batteries", () => {
    const { values } = buildModelUpdate({ ...model, packSize: "6", packsPerBox: "10", boxesPerCarton: "" }, { category: "battery" });
    expect(values).toMatchObject({ pack_size: 6, packs_per_box: 10, boxes_per_carton: null });
    expect(buildModelUpdate({ ...model, salePrice: null }, { category: "device" }).error).toMatch(/Satış fiyatı/);
  });

  it("warns only when the rule becomes Zorunlu and shelf units lack a serial", () => {
    expect(serialRuleWarning({ from: "optional", to: "required", serialLessCount: 3 })).toMatch(/3 birim/);
    expect(serialRuleWarning({ from: "required", to: "required", serialLessCount: 3 })).toBeNull();
    expect(serialRuleWarning({ from: "none", to: "required", serialLessCount: 0 })).toBeNull();
    expect(serialRuleWarning({ from: "none", to: "optional", serialLessCount: 5 })).toBeNull();
  });
});

describe("unit editing", () => {
  const options = { category: "device", serialPolicy: "required", collapsed: false, today: "2026-11-14" };

  it("writes serial, side, date and WSA code for one unit", () => {
    const { values } = buildUnitUpdate(
      { serialNo: " SN1 ", earSide: "left", productionDate: "2026-01-02", wsaCode: " W-1 " },
      options
    );
    expect(values).toEqual({ ear_side: "left", production_date: "2026-01-02", serial_no: "SN1", wsa_code: "W-1" });
  });

  it("follows the model's serial rule", () => {
    expect(buildUnitUpdate({ serialNo: "" }, options).error).toMatch(/zorunlu/);
    expect(buildUnitUpdate({ serialNo: "X" }, { ...options, serialPolicy: "none" }).error).toMatch(/seri numarasız/);
    expect(buildUnitUpdate({ serialNo: "" }, { ...options, serialPolicy: "optional" }).values.serial_no).toBeNull();
    expect(buildUnitUpdate({ serialNo: "x".repeat(61) }, options).error).toMatch(/60 karakter/);
  });

  it("refuses a future or broken production date and an unknown side", () => {
    expect(buildUnitUpdate({ serialNo: "A", productionDate: "2026-11-15" }, options).error).toMatch(/Üretim tarihi/);
    expect(buildUnitUpdate({ serialNo: "A", productionDate: "14.11.2026" }, options).error).toMatch(/Üretim tarihi/);
    expect(buildUnitUpdate({ serialNo: "A", earSide: "up" }, options).error).toMatch(/Tarafı/);
  });

  it("leaves the side out for groups without sides", () => {
    const { values } = buildUnitUpdate({ serialNo: "A", earSide: "left" }, { ...options, category: "charger" });
    expect(values).not.toHaveProperty("ear_side");
  });

  it("changes only side and date on a collapsed row, whatever the serial rule says", () => {
    const { values } = buildUnitUpdate(
      { serialNo: "IGNORED", earSide: "right", productionDate: "", wsaCode: "W" },
      { ...options, category: "receiver", collapsed: true }
    );
    expect(values).toEqual({ ear_side: "right", production_date: null });
  });

  it("checks a corrected purchase price", () => {
    expect(purchasePriceError(0)).toBeNull();
    expect(purchasePriceError(1234.56)).toBeNull();
    expect(purchasePriceError(-1)).toMatch(/eksi/);
    expect(purchasePriceError(null)).toMatch(/biçiminde/);
    expect(purchasePriceError("100")).toMatch(/biçiminde/);
    expect(purchasePriceError(1e10)).toMatch(/çok büyük/);
  });
});

describe("photos", () => {
  it("accepts WebP, JPEG and PNG up to the limit", () => {
    expect(photoFileError({ type: "image/webp", size: 200_000 })).toBeNull();
    expect(photoFileError({ type: "image/png", size: MAX_PHOTO_BYTES })).toBeNull();
    expect(photoFileError({ type: "image/svg+xml", size: 100 })).toMatch(/JPEG, PNG ya da WebP/);
    expect(photoFileError({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 })).toMatch(/1 MB/);
    expect(photoFileError({ type: "image/jpeg", size: 0 })).toMatch(/boş/);
    expect(photoFileError(null)).toMatch(/seçin/);
    expect(photoFileError("not a file")).toMatch(/seçin/);
  });
});

describe("stock removal", () => {
  it("cleans the unit id list or refuses it whole", () => {
    expect(cleanUnitIds([3, "4", 3])).toEqual([3, 4]);
    expect(cleanUnitIds([])).toBeNull();
    expect(cleanUnitIds([1, 0])).toBeNull();
    expect(cleanUnitIds([1, "x"])).toBeNull();
    expect(cleanUnitIds("1")).toBeNull();
    expect(cleanUnitIds(Array.from({ length: 501 }, (_, i) => i + 1))).toBeNull();
    expect(cleanUnitIds(Array.from({ length: 500 }, (_, i) => i + 1))).toHaveLength(500);
  });

  it("builds the remove_stock_units arguments", () => {
    expect(buildRemovalArgs({ unitIds: [5, 6], reason: "damaged_lost", note: "  " })).toEqual({
      args: { unitIds: [5, 6], reason: "damaged_lost", note: null },
    });
    expect(buildRemovalArgs({ unitIds: [5], reason: "entry_error", note: " typo " }).args.note).toBe("typo");
  });

  it("needs units, a known reason, a short note, and a note for Diğer", () => {
    expect(buildRemovalArgs({ unitIds: [], reason: "other", note: "x" }).error).toMatch(/birimleri seçin/);
    expect(buildRemovalArgs({ unitIds: [1], reason: "stolen" }).error).toMatch(/nedenini/);
    expect(buildRemovalArgs({ unitIds: [1], reason: "other", note: " " }).error).toMatch(/Diğer/);
    expect(buildRemovalArgs({ unitIds: [1], reason: "other", note: "x".repeat(501) }).error).toMatch(/500 karakter/);
    expect(buildRemovalArgs({ unitIds: [1], reason: "other", note: "Kırıldı" }).args.reason).toBe("other");
  });

  it("picks the first n units of a collapsed row and one serial row", () => {
    const rows = [
      { id: 1, serialNo: null, count: 3, unitIds: [1, 2, 3] },
      { id: 7, serialNo: "S7", count: 1, unitIds: [7] },
      { id: 8, serialNo: "S8", count: 1, unitIds: [8] },
    ];
    expect(pickedUnitIds(rows, { 1: 2, 8: 1 })).toEqual([1, 2, 8]);
    expect(pickedUnitIds(rows, { 1: 9, 7: -1 })).toEqual([1, 2, 3]);
    expect(pickedUnitIds(rows, {})).toEqual([]);
    expect(rowBySerial(rows, " S7 ")?.id).toBe(7);
    expect(rowBySerial(rows, "S9")).toBeNull();
    expect(rowBySerial(rows, "")).toBeNull();
  });
});
