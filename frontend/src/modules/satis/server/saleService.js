import "server-only";
import { todayInClinic } from "@/lib/dates";
import { parseScan, normalizeGtin } from "@/lib/gs1";
import * as repo from "./saleRepository";
import { ValidationError } from "./errors";
import { buildPaymentRow, buildSaleArgs } from "../saleRules";

// Selling (docs/faz-2-satis-plani.md). The wizard's cart comes from the browser; the database function checks stock,
// payments and VAT again (016), so this layer only shapes the input and explains problems in Turkish.
// Callers must `await io()` first: "today" reads the clock.

function brandAndName(product) {
  return [product?.brands?.name, product?.name].filter(Boolean).join(" ");
}

function toNumberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

// Everything the wizard needs once: payment methods, post-sale site links and the service price list.
export async function loadCatalog() {
  const [methods, links, services] = await Promise.all([repo.listPaymentMethods(), repo.listSiteLinks(), repo.listServices()]);
  return {
    paymentMethods: methods.map((method) => ({ code: method.code, name: method.name })),
    sites: Object.fromEntries(links.map((link) => [link.system_key, { name: link.name, url: link.url }])),
    services: services.map((service) => ({ id: service.id, category: service.category, name: service.name, price: Number(service.price) })),
  };
}

// The models of one group with something on the shelf, priced for a retail or a wholesale sale.
export async function loadGroupModels(category) {
  const rows = await repo.listGroupModels(String(category ?? ""));
  const months = new Map((await repo.listWarrantyMonths(rows.map((row) => row.product_id))).map((row) => [row.id, row.warranty_months]));
  return rows.map((row) => ({
    productId: row.product_id,
    name: [row.brand_name, row.name].filter(Boolean).join(" "),
    type: row.type,
    category: String(category),
    serialTracked: row.serial_policy !== "none",
    salePrice: Number(row.sale_price),
    wholesalePrice: toNumberOrNull(row.wholesale_price),
    inStock: Number(row.in_stock),
    warrantyMonths: Number(months.get(row.product_id) ?? 0),
  }));
}

function toUnit(row) {
  return {
    unitId: row.id,
    productId: row.product_id,
    serial: row.serial_no,
    earSide: row.ear_side,
    name: brandAndName(row.products),
    category: row.products?.category,
    salePrice: Number(row.products?.sale_price ?? 0),
    wholesalePrice: toNumberOrNull(row.products?.wholesale_price),
    warrantyMonths: Number(row.products?.warranty_months ?? 0),
  };
}

export async function loadModelUnits(productId) {
  return (await repo.listModelUnits(Number(productId))).map(toUnit);
}

// A scanned or typed code → the unit on the shelf (serial or GS1 label), or the model of a GTIN, or nothing.
export async function findByCode(text) {
  const scan = parseScan(String(text ?? ""));
  const serial = (scan.serial ?? scan.raw ?? "").trim();
  if (serial) {
    const unit = await repo.findUnitBySerial(serial);
    if (unit) {
      if (unit.status !== "in_stock") throw new ValidationError(`${serial} stokta değil (satılmış, serviste ya da çıkarılmış).`);
      return { kind: "unit", unit: toUnit(unit) };
    }
  }
  const code = scan.gtin ?? (/^\d{8,14}$/.test(serial) ? serial : null);
  if (code) {
    const short = normalizeGtin(code);
    const products = await repo.findProductsByGtin([short, short.padStart(14, "0")]);
    if (products.length) return { kind: "model", productId: products[0].id, category: products[0].category };
  }
  return { kind: "none" };
}

export async function createSale(input) {
  const built = buildSaleArgs(input, { today: todayInClinic() });
  if (built.error) throw new ValidationError(built.error);
  return { saleId: await repo.createSale(built.args) };
}

// The sale as the "Site işlemleri" form shows it. patientId guards against an id from another patient's card.
export async function loadFollowup(saleId, patientId) {
  const sale = await repo.getSaleForFollowup(Number(saleId));
  if (!sale || sale.sale_kind === "legacy" || (patientId && sale.patient_id !== Number(patientId))) {
    throw new ValidationError("Satış bulunamadı; sayfayı yenileyin.");
  }
  const invoices = new Map((sale.invoices ?? []).map((invoice) => [invoice.id, invoice.invoice_no]));
  return {
    saleId: sale.id,
    kind: sale.sale_kind,
    saleDate: sale.sale_date,
    invoiceMode: sale.invoice_mode,
    invoiceNo: sale.invoices?.[0]?.invoice_no ?? "",
    ticked: (sale.sale_tasks ?? []).map((task) => task.links?.system_key).filter(Boolean),
    items: (sale.sale_items ?? [])
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((item) => ({
        saleItemId: item.id,
        name: item.services?.name ?? brandAndName(item.stock_units?.products),
        serial: item.stock_units?.serial_no ?? null,
        category: item.stock_units?.products?.category ?? null,
        utsNo: item.uts_report_no ?? "",
        warrantyStart: item.warranty_start ?? sale.sale_date,
        warrantyEnd: item.warranty_end ?? "",
        invoiceNo: invoices.get(item.invoice_id) ?? "",
      })),
  };
}

export async function saveFollowup(saleId, patientId, input) {
  const current = await loadFollowup(saleId, patientId);
  const known = new Set(current.items.map((item) => item.saleItemId));
  const items = (input?.items ?? []).map((item) => {
    if (!known.has(Number(item.saleItemId))) throw new ValidationError("Kalem bu satışa ait değil; sayfayı yenileyin.");
    if (item.warrantyEnd && item.warrantyStart && item.warrantyEnd < item.warrantyStart) {
      throw new ValidationError("Garanti bitişi garanti başlangıcından önce olamaz.");
    }
    return {
      sale_item_id: Number(item.saleItemId),
      uts_report_no: item.utsNo ?? "",
      warranty_start: item.warrantyStart ?? "",
      warranty_end: item.warrantyEnd ?? "",
      invoice_no: item.invoiceNo ?? "",
    };
  });
  const tasks = Object.fromEntries(Object.entries(input?.sites ?? {}).map(([key, done]) => [key, Boolean(done)]));
  await repo.updateSaleFollowup(current.saleId, {
    items,
    invoiceNo: current.invoiceMode === "single" ? String(input?.invoiceNo ?? "").trim() || null : null,
    tasks,
  });
}

async function findBalance(saleId, patientId) {
  const balance = await repo.getSaleBalance(Number(saleId));
  if (!balance || balance.sale_kind === "legacy" || (patientId && balance.patient_id !== Number(patientId))) {
    throw new ValidationError("Satış bulunamadı; sayfayı yenileyin.");
  }
  return balance;
}

export async function loadBalance(saleId, patientId) {
  const balance = await findBalance(saleId, patientId);
  return { patient: Number(balance.patient_remaining), sgk: Number(balance.sgk_remaining) };
}

// "Tahsilat ekle": what is owed is read from the database, not from the browser.
export async function addPayment(saleId, patientId, input) {
  const balance = await findBalance(saleId, patientId);
  const due = { patient: Number(balance.patient_remaining), sgk: Number(balance.sgk_remaining) };
  const built = buildPaymentRow(input, { due, today: todayInClinic() });
  if (built.error) throw new ValidationError(built.error);
  await repo.insertPayment(balance.sale_id, built.row);
}


