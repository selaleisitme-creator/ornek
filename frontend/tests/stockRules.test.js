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
} from "@/modules/stok/stockRules";

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
    expect(readStockQuery({})).toEqual({ grup: "cihaz", marka: null, ara: null, gorunum: "tablo", ac: null });
    expect(readStockQuery({ grup: "pil", marka: "3", ara: "  Viron ", gorunum: "kart", ac: "17" })).toEqual({
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
