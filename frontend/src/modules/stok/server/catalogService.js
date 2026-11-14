import "server-only";
import { PURCHASE_PAYMENT_CODES, STOCK_GROUPS } from "../stockRules";
import * as repo from "./catalogRepository";
import { ValidationError } from "./errors";

// Brands, suppliers and model lists for the stock entry window.

function cleanName(value, label) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new ValidationError(`${label} boş olamaz.`);
  if (name.length > 80) throw new ValidationError(`${label} en fazla 80 karakter olabilir.`);
  return name;
}

// Adding a name that already exists hands back the existing row instead of an error: whoever typed it
// wanted that brand selected, and a second "Phonak" is exactly what the unique index forbids.
async function findOrInsert(name, find, insert) {
  const existing = await find(name);
  if (existing) return existing;
  try {
    return await insert(name);
  } catch (error) {
    // Someone else added it between the lookup and the insert.
    if (error?.code === "23505") {
      const row = await find(name);
      if (row) return row;
    }
    throw error;
  }
}

export function addBrand(name) {
  return findOrInsert(cleanName(name, "Marka adı"), repo.findBrandByName, repo.insertBrand);
}

export function addSupplier(input) {
  return findOrInsert(cleanName(input?.name, "Tedarikçi adı"), repo.findSupplierByName, repo.insertSupplier);
}

// Everything the entry window needs before it opens, loaded with the page so the window opens at once.
export async function getEntryOptions() {
  const [brands, suppliers, paymentMethods] = await Promise.all([
    repo.listActiveBrands(),
    repo.listActiveSuppliers(),
    repo.listPaymentMethods(PURCHASE_PAYMENT_CODES),
  ]);
  return { brands, suppliers, paymentMethods };
}

function toNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

// Models of one group (and brand, for devices) with their shelf count, for step 2 of the window.
export async function listModels(input) {
  const category = String(input?.category ?? "");
  if (!STOCK_GROUPS.some((group) => group.category === category)) throw new ValidationError("Ürün grubunu seçin.");
  const brandId = Number(input?.brandId) || null;
  if (brandId !== null && !(Number.isSafeInteger(brandId) && brandId > 0)) throw new ValidationError("Marka geçersiz.");

  const rows = await repo.listProducts({ category, brandId });
  const counts = await repo.listInStockCounts(rows.map((row) => row.id));
  const inStock = new Map(counts.map((row) => [row.product_id, Number(row.in_stock) || 0]));

  return rows.map((row) => ({
    id: row.id,
    brandId: row.brand_id,
    brandName: row.brands?.name ?? "",
    category,
    name: row.name,
    type: row.type,
    gtin: row.gtin,
    packageBarcode: row.package_barcode,
    serialPolicy: row.serial_policy,
    unit: row.unit,
    packSize: row.pack_size,
    packsPerBox: row.packs_per_box,
    boxesPerCarton: row.boxes_per_carton,
    salePrice: toNumber(row.sale_price),
    purchasePrice: toNumber(row.purchase_price),
    inStock: inStock.get(row.id) ?? 0,
  }));
}
