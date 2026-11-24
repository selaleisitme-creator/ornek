import { describe, expect, it } from "vitest";
import { buildFollowupUpdate, buildLegacyArgs, buildReplaceArgs, currentDevices, serialFromScan } from "@/modules/hastalar/deviceRules";

const unit = (id, serial, extra = {}) => ({
  id,
  serial_no: serial,
  ear_side: "right",
  products: { name: "Alpha 5", category: "device", brand_id: 7, brands: { name: "Bernafon" } },
  ...extra,
});

const sales = [
  {
    id: 1,
    sale_date: "2025-01-10",
    sale_kind: "retail",
    sale_items: [
      { id: 11, ear_side: "right", warranty_start: "2025-01-10", warranty_end: "2027-01-10", stock_units: unit(101, "SN-R"), refunds: [] },
      { id: 12, ear_side: "left", warranty_start: "2025-01-10", warranty_end: "2027-01-10", stock_units: unit(102, "SN-L"), refunds: [{ returns_device: true }] },
      { id: 13, ear_side: null, stock_units: unit(103, "DOME", { products: { name: "Kubbe", category: "dome", brands: { name: "X" } } }), refunds: [] },
    ],
  },
  {
    id: 2,
    sale_date: "2021-05-02",
    sale_kind: "legacy",
    sale_items: [{ id: 21, ear_side: null, warranty_start: null, warranty_end: null, stock_units: unit(201, "OLD", { ear_side: "left" }), refunds: [] }],
  },
];
const replacements = [
  { id: 5, sale_item_id: 11, new_unit: unit(301, "SN-R2") },
  { id: 9, sale_item_id: 11, new_unit: unit(302, "SN-R3") },
];

describe("current devices", () => {
  it("lists the device each sale item stands for now, newest sale first, without returns and accessories", () => {
    const devices = currentDevices(sales, replacements);
    expect(devices.map((device) => [device.saleItemId, device.serial, device.earSide, device.legacy])).toEqual([
      [11, "SN-R3", "right", false],
      [21, "OLD", "left", true],
    ]);
    expect(devices[0]).toMatchObject({ name: "Bernafon Alpha 5", brandId: 7, warrantyStart: "2025-01-10", warrantyEnd: "2027-01-10" });
    // A legacy item without a warranty start counts from its sale date.
    expect(devices[1].warrantyStart).toBe("2021-05-02");
  });
});

describe("follow-up fields", () => {
  const current = currentDevices(sales, replacements);
  const today = "2026-11-24";

  it("keeps only what changed", () => {
    const built = buildFollowupUpdate(
      {
        adaptationStart: "2026-11-01",
        devices: [
          { saleItemId: 11, earSide: "right", warrantyEnd: "2027-06-30" },
          { saleItemId: 21, earSide: "left", warrantyEnd: "" },
        ],
      },
      { current, today }
    );
    expect(built).toEqual({ adaptationStart: "2026-11-01", items: [{ saleItemId: 11, values: { warranty_end: "2027-06-30" } }] });
    expect(buildFollowupUpdate({ adaptationStart: "", devices: [] }, { current, today })).toEqual({ adaptationStart: null, items: [] });
  });

  it("refuses dates and items that cannot be right", () => {
    expect(buildFollowupUpdate({ adaptationStart: "2026-12-01" }, { current, today }).error).toMatch(/bugünden sonra/);
    expect(buildFollowupUpdate({ devices: [{ saleItemId: 12 }] }, { current, today }).error).toMatch(/bulunamadı/);
    expect(buildFollowupUpdate({ devices: [{ saleItemId: 11, earSide: "up" }] }, { current, today }).error).toMatch(/Kulak/);
    expect(buildFollowupUpdate({ devices: [{ saleItemId: 11, earSide: "right", warrantyEnd: "2024-01-01" }] }, { current, today }).error).toMatch(
      /garanti başlangıcından önce/
    );
  });
});

describe("serial numbers", () => {
  it("takes the serial from a GS1 label, or the text as typed", () => {
    expect(serialFromScan("(01)05714464091134(21)SN-777")).toBe("SN-777");
    expect(serialFromScan("  SL-63001 ")).toBe("SL-63001");
    expect(serialFromScan("")).toBeNull();
  });
});

describe("replacement", () => {
  const device = currentDevices(sales, replacements)[0];
  const today = "2026-11-24";

  it("builds the arguments for a unit on the shelf or one from the manufacturer", () => {
    expect(buildReplaceArgs({ unitId: 55, reason: "warranty", replacedOn: "2026-11-20", note: " ok " }, { device, today })).toEqual({
      args: { saleItemId: 11, newUnit: { id: 55 }, reason: "warranty", replacedOn: "2026-11-20", note: "ok", warrantyEnd: null },
    });
    const fromMaker = buildReplaceArgs({ productId: 4, serialNo: " NEW-1 ", reason: "service", warrantyEnd: "2028-11-24" }, { device, today });
    expect(fromMaker.args).toMatchObject({
      newUnit: { product_id: 4, serial_no: "NEW-1", ear_side: "right" },
      replacedOn: today,
      warrantyEnd: "2028-11-24",
    });
  });

  it("refuses what the database would refuse", () => {
    expect(buildReplaceArgs({ reason: "warranty" }, { device, today }).error).toMatch(/modelini/);
    expect(buildReplaceArgs({ productId: 4, reason: "warranty" }, { device, today }).error).toMatch(/seri numarasını/);
    expect(buildReplaceArgs({ unitId: 5, reason: "gift" }, { device, today }).error).toMatch(/nedenini/);
    expect(buildReplaceArgs({ unitId: 5, reason: "warranty", replacedOn: "2026-11-25" }, { device, today }).error).toMatch(/bugünden sonra/);
    expect(buildReplaceArgs({ unitId: 5, reason: "warranty", replacedOn: "2024-01-01" }, { device, today }).error).toMatch(/satış tarihinden önce/);
    expect(buildReplaceArgs({ unitId: 5, reason: "warranty", warrantyEnd: "2024-01-01" }, { device, today }).error).toMatch(/garanti başlangıcından/);
    expect(buildReplaceArgs({ unitId: 5, reason: "warranty" }, { device: null, today }).error).toMatch(/seçin/);
  });
});

describe("legacy device", () => {
  const today = "2026-11-24";
  const good = { productId: 3, serialNo: "OLD-9", earSide: "left", saleDate: "2022-03-01", warrantyEnd: "2024-03-01", unitPrice: 25000.555 };

  it("builds the arguments for a listed model or a new one", () => {
    expect(buildLegacyArgs(good, { today })).toEqual({
      args: {
        product: { id: 3 },
        unit: { serial_no: "OLD-9", ear_side: "left" },
        sale: { sale_date: "2022-03-01", warranty_end: "2024-03-01", unit_price: 25000.56 },
      },
    });
    const newModel = buildLegacyArgs({ ...good, productId: null, brandId: 7, modelName: " Eski  Model ", modelType: "", unitPrice: null }, { today });
    expect(newModel.args.product).toEqual({ brand_id: 7, name: "Eski Model", type: null });
    expect(newModel.args.sale.unit_price).toBe(0);
  });

  it("refuses missing or impossible fields", () => {
    expect(buildLegacyArgs({ ...good, productId: null }, { today }).error).toMatch(/Markayı/);
    expect(buildLegacyArgs({ ...good, productId: null, brandId: 7 }, { today }).error).toMatch(/Model adını/);
    expect(buildLegacyArgs({ ...good, serialNo: " " }, { today }).error).toMatch(/Seri/);
    expect(buildLegacyArgs({ ...good, earSide: "" }, { today }).error).toMatch(/Kulak/);
    expect(buildLegacyArgs({ ...good, saleDate: "2026-11-25" }, { today }).error).toMatch(/bugünden sonra/);
    expect(buildLegacyArgs({ ...good, warrantyEnd: "2021-01-01" }, { today }).error).toMatch(/satış tarihinden önce/);
    expect(buildLegacyArgs({ ...good, unitPrice: -1 }, { today }).error).toMatch(/tutarı/);
  });
});
