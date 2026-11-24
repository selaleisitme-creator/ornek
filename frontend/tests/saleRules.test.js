import { describe, expect, it } from "vitest";
import {
  buildPaymentRow,
  buildSaleArgs,
  cartTotals,
  defaultTaxRate,
  paymentSummary,
  sitesFor,
  warrantyEndFor,
} from "@/modules/satis/saleRules";

const device = (unitId, price = 30000) => ({ key: `u${unitId}`, type: "unit", unitId, name: "Alpha", category: "device", unitPrice: price, taxRate: 0, earSide: "right" });
const packs = { key: "p1", type: "product", productId: 5, name: "Pil 312", category: "battery", quantity: 2, maxQuantity: 3, unitPrice: 120, taxRate: 20 };
const service = { key: "s1", type: "service", serviceId: 7, name: "Filtre", quantity: 1, unitPrice: 1000, taxRate: 20, serviceNote: "değişti" };
const custom = { key: "c1", type: "custom", name: " Özel Temizlik ", quantity: 1, unitPrice: 500, taxRate: 10 };
const today = "2026-11-24";

describe("cart totals", () => {
  it("takes the VAT out of VAT-inclusive prices and shares the discount like the database", () => {
    expect(cartTotals([device(1), device(2), packs, service, custom], 1000)).toEqual({ gross: 61740, discount: 1000, total: 60740, vat: 248.04 });
    expect(cartTotals([packs], 0)).toEqual({ gross: 240, discount: 0, total: 240, vat: 40 });
    expect(cartTotals([packs], 999).discount).toBe(240);
  });

  it("suggests the VAT rate and the warranty end", () => {
    expect(defaultTaxRate("device")).toBe(0);
    expect(defaultTaxRate("dome")).toBe(20);
    expect(warrantyEndFor("2026-11-24", 24)).toBe("2028-11-24");
    expect(warrantyEndFor("", 24)).toBe("");
  });

  it("shows what the patient still owes", () => {
    expect(paymentSummary(60740, 10000, [{ amount: 40000 }])).toEqual({ sgk: 10000, patientShare: 50740, paid: 40000, remaining: 10740 });
  });

  it("asks for the invoice before ÜTS in a wholesale sale", () => {
    expect(sitesFor("wholesale").map((site) => site.key)).toEqual(["kolaysoft", "uts"]);
    expect(sitesFor("retail")).toHaveLength(4);
  });
});

describe("sale arguments", () => {
  const input = {
    kind: "retail",
    patientId: 9,
    saleDate: "2026-11-23",
    discount: 1000,
    sgkAmount: 10000,
    invoiceMode: "single",
    invoiceNo: " SF-1 ",
    lines: [{ ...device(1), utsNo: " UTS-1 ", warrantyEnd: "2028-11-23" }, packs, service, custom],
    payments: [{ method: "card_pos", amount: 20000, installments: 3 }, { method: "cash", amount: 0 }],
    sites: { uts: true, wsa: false, kolaysoft: true },
  };

  it("builds create_sale's four arguments", () => {
    const built = buildSaleArgs(input, { today });
    expect(built.args.sale).toEqual({ patient_id: 9, sale_date: "2026-11-23", discount: 1000, sgk_amount: 10000, invoice_mode: "single", invoice_no: "SF-1" });
    expect(built.args.items).toEqual([
      { unit_price: 30000, tax_rate: 0, stock_unit_id: 1, ear_side: "right", mold_type: null, uts_report_no: "UTS-1", warranty_end: "2028-11-23" },
      { unit_price: 120, tax_rate: 20, product_id: 5, quantity: 2, mold_type: null },
      { unit_price: 1000, tax_rate: 20, service_id: 7, quantity: 1, service_note: "değişti" },
      { unit_price: 500, tax_rate: 10, custom_service: { name: "Özel Temizlik", category: "service" }, quantity: 1 },
    ]);
    expect(built.args.payments).toEqual([{ payment_method: "card_pos", amount: 20000, installments: 3 }]);
    expect(built.args.tasks).toEqual(["uts", "kolaysoft"]);
    expect(built.summary.remaining).toBe(740);
  });

  it("builds a wholesale sale with per-item invoices", () => {
    const built = buildSaleArgs(
      { kind: "wholesale", customerName: " Örnek Merkez ", customerPhone: "+902120000000", invoiceMode: "per_item", lines: [{ ...device(3), invoiceNo: "TF-1" }], sgkAmount: 500 },
      { today }
    );
    expect(built.args.sale).toMatchObject({ kind: "wholesale", customer_name: "Örnek Merkez", sgk_amount: null, invoice_mode: "per_item", invoice_no: null });
    expect(built.args.items[0].invoice_no).toBe("TF-1");
  });

  it("refuses what the database would refuse", () => {
    expect(buildSaleArgs({ ...input, lines: [] }, { today }).error).toMatch(/en az bir/);
    expect(buildSaleArgs({ ...input, saleDate: "2026-11-25" }, { today }).error).toMatch(/bugünden sonra/);
    expect(buildSaleArgs({ ...input, lines: [{ ...device(1), taxRate: 20 }] }, { today }).error).toMatch(/%0 KDV/);
    expect(buildSaleArgs({ ...input, lines: [{ ...packs, taxRate: 18 }] }, { today }).error).toMatch(/KDV oranını/);
    expect(buildSaleArgs({ ...input, lines: [{ ...packs, quantity: 4 }] }, { today }).error).toMatch(/stokta 3 adet/);
    expect(buildSaleArgs({ ...input, discount: 99999 }, { today }).error).toMatch(/İndirim/);
    expect(buildSaleArgs({ ...input, sgkAmount: 99999 }, { today }).error).toMatch(/SGK/);
    expect(buildSaleArgs({ ...input, payments: [{ method: "cash", amount: 60000 }] }, { today }).error).toMatch(/aşıyor/);
    expect(buildSaleArgs({ ...input, payments: [{ method: "", amount: 10 }] }, { today }).error).toMatch(/ödeme şeklini/);
    expect(buildSaleArgs({ kind: "wholesale", customerName: "X", lines: [service] }, { today }).error).toMatch(/yalnızca ürün/);
    expect(buildSaleArgs({ kind: "wholesale", customerName: " ", lines: [packs] }, { today }).error).toMatch(/alıcının/);
  });
});

describe("collecting a payment later", () => {
  const due = { patient: 1740, sgk: 10000 };

  it("builds a patient or SGK payment within what is owed", () => {
    expect(buildPaymentRow({ payer: "patient", method: "cash", amount: 1000 }, { due, today })).toEqual({
      row: { payer: "patient", payment_method: "cash", amount: 1000, installments: null, paid_on: today },
    });
    expect(buildPaymentRow({ payer: "sgk", amount: 10000, paidOn: "2026-11-20" }, { due, today }).row).toMatchObject({ payer: "sgk", payment_method: "transfer" });
  });

  it("refuses too much, nothing, or a future date", () => {
    expect(buildPaymentRow({ payer: "patient", method: "cash", amount: 2000 }, { due, today }).error).toMatch(/kalan borcunu/);
    expect(buildPaymentRow({ payer: "sgk", amount: 10001 }, { due, today }).error).toMatch(/SGK/);
    expect(buildPaymentRow({ payer: "patient", method: "cash", amount: 0 }, { due, today }).error).toMatch(/Tutarı/);
    expect(buildPaymentRow({ payer: "patient", method: "cash", amount: 10, paidOn: "2026-11-25" }, { due, today }).error).toMatch(/bugünden sonra/);
  });
});
