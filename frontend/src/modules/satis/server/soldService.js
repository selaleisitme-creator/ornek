import "server-only";
import { todayInClinic } from "@/lib/dates";
import { parseScan } from "@/lib/gs1";
import * as repo from "./soldRepository";
import { ValidationError } from "./errors";
import { buildRefundArgs, buildSoldInfo, matchesSoldSearch, missingInfo } from "../refundRules";

// Stok > Satılan ürünler (docs/faz-2-satis-plani.md, section 3): the sold goods, their post-sale information and refunds.
// Callers must `await io()` first: "today" reads the clock.

// The clinic sells a few thousand items at most; the newest ones are listed and searched.
export const SOLD_LIMIT = 1000;

function toItem(row, valueOf) {
  const sale = row.sales ?? {};
  const unit = row.stock_units ?? {};
  const product = unit.products ?? {};
  const refund = [].concat(row.refunds ?? [])[0] ?? null;
  const payments = (sale.sale_payments ?? []).filter((payment) => payment.payer !== "sgk");
  const item = {
    saleItemId: row.id,
    saleId: sale.id,
    saleNo: sale.sale_no,
    saleDate: sale.sale_date,
    legacy: sale.sale_kind === "legacy",
    wholesale: sale.sale_kind === "wholesale",
    patientId: sale.patient_id,
    buyer: sale.patients?.full_name ?? sale.customer_name ?? null,
    product: [product.brands?.name, product.name].filter(Boolean).join(" "),
    category: product.category,
    isDevice: product.category === "device" || product.category === "receiver",
    unitId: unit.id,
    serial: unit.serial_no,
    productionDate: unit.production_date,
    wsaCode: unit.wsa_code,
    utsNo: row.uts_report_no,
    earSide: row.ear_side,
    warrantyEnd: row.warranty_end,
    value: valueOf.get(row.id) ?? Number(row.unit_price),
    purchasePrice: row.cost_at_sale === null || row.cost_at_sale === undefined ? null : Number(row.cost_at_sale),
    paymentText: [...new Set(payments.map((payment) => payment.payment_methods?.name).filter(Boolean))].join(" + ") || null,
    paymentMethod: payments[0]?.payment_methods?.code ?? null,
    refunded: Boolean(refund),
    refund: refund ? { amount: Number(refund.amount), date: refund.refunded_on, returnsDevice: refund.returns_device } : null,
  };
  return { ...item, missing: refund ? [] : missingInfo(item) };
}

async function withValues(rows) {
  const values = await repo.listItemValues(rows.map((row) => row.id));
  return new Map(values.map((row) => [row.sale_item_id, Number(row.net_value)]));
}

// search: words (product, serial, buyer, sale number) or a scanned GS1 label (its serial).
export async function listSoldItems({ search } = {}) {
  const rows = await repo.listSoldItems(SOLD_LIMIT);
  const valueOf = await withValues(rows);
  const scan = parseScan(String(search ?? ""));
  const text = scan.gtin ? (scan.serial ?? "") : search;
  return rows.map((row) => toItem(row, valueOf)).filter((item) => matchesSoldSearch(item, text));
}

async function findItem(id) {
  const itemId = Number(id);
  if (!Number.isSafeInteger(itemId) || itemId < 1) throw new ValidationError("Satılan ürünü seçin.");
  const row = await repo.getSoldItem(itemId);
  if (!row || !row.stock_units) throw new ValidationError("Satış kaydı bulunamadı; sayfayı yenileyin.");
  return toItem(row, await withValues([row]));
}

export async function saveSoldInfo(id, input) {
  const item = await findItem(id);
  const built = buildSoldInfo(input, { item });
  if (built.error) throw new ValidationError(built.error);
  if (!(await repo.updateUnit(item.unitId, built.unit))) throw new ValidationError("Bilgiler kaydedilemedi; sayfayı yenileyin.");
  if ((item.utsNo ?? "") !== built.utsNo) await repo.updateItemUts(item.saleItemId, built.utsNo);
}

export async function refund(id, input) {
  const item = await findItem(id);
  const built = buildRefundArgs(input, { item, today: todayInClinic() });
  if (built.error) throw new ValidationError(built.error);
  return { refundId: await repo.createRefund(built.args), amount: built.args.amount, method: built.args.method };
}
