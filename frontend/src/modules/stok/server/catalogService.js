import "server-only";
import { randomUUID } from "node:crypto";
import { todayInClinic } from "@/lib/dates";
import {
  PURCHASE_PAYMENT_CODES,
  STOCK_GROUPS,
  buildModelUpdate,
  buildUnitUpdate,
  cleanUnitIds,
  photoFileError,
  purchasePriceError,
} from "../stockRules";
import * as repo from "./catalogRepository";
import { ValidationError } from "./errors";

// Brands, suppliers and model lists for the stock entry window; editing models, units and photos.

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

// ---------------------------------------------------------------------------
// Model editing
// ---------------------------------------------------------------------------

function positiveId(value, message) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ValidationError(message);
  return id;
}

async function activeProduct(id) {
  const product = await repo.getProductForEdit(positiveId(id, "Model seçin."));
  if (!product?.active) throw new ValidationError("Bu model bulunamadı ya da pasif.");
  return product;
}

export async function updateModel(id, input) {
  const product = await activeProduct(id);
  const built = buildModelUpdate(input, { category: product.category });
  if (built.error) throw new ValidationError(built.error);
  // A sale price change is logged by the products trigger (001), so nothing else is written here.
  const updated = await repo.updateProduct(product.id, built.values);
  if (!updated) throw new ValidationError("Model güncellenemedi; sayfayı yenileyip tekrar deneyin.");
}

// A model with units on the shelf stays active: hiding it would hide stock that can still be sold.
export async function deactivateModel(id) {
  const product = await activeProduct(id);
  if ((await repo.countInStockUnits(product.id)) > 0) {
    throw new ValidationError("Stokta birimi olan model pasifleştirilemez.");
  }
  const updated = await repo.updateProduct(product.id, { active: false });
  if (!updated) throw new ValidationError("Model pasifleştirilemedi; sayfayı yenileyip tekrar deneyin.");
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

const PHOTO_EXTENSIONS = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

// The browser already shrank the file, but the type and size are checked again: the action can be called
// directly. A random file name keeps public photo addresses unguessable and never clashes.
export async function addPhoto(productId, file) {
  const problem = photoFileError(file);
  if (problem) throw new ValidationError(problem);
  const product = await activeProduct(productId);

  const path = `${product.id}/${randomUUID()}.${PHOTO_EXTENSIONS[file.type]}`;
  await repo.uploadPhotoFile(path, file);
  try {
    return await repo.insertPhoto(product.id, path);
  } catch (error) {
    // Without its row nobody can see or delete the file, so it must not stay in Storage.
    await repo.removePhotoFile(path).catch((removeError) => console.error(removeError));
    throw error;
  }
}

// Row first: once it is gone the photo disappears from the screen. A file left behind after a failed
// Storage call is only wasted space, so that failure is logged instead of reported as a failed delete.
export async function removePhoto(photoId) {
  const photo = await repo.getPhoto(positiveId(photoId, "Fotoğraf seçin."));
  if (!photo) throw new ValidationError("Bu fotoğraf bulunamadı.");
  await repo.deletePhoto(photo.id);
  await repo.removePhotoFile(photo.storage_path).catch((error) => console.error(error));
}

// ---------------------------------------------------------------------------
// Unit editing
// ---------------------------------------------------------------------------

// The units of one model that are on the shelf. A collapsed "8 adet" row sends all its ids.
async function shelfUnits(unitIds) {
  const ids = cleanUnitIds(unitIds);
  if (!ids) throw new ValidationError("Düzenlenecek birimi seçin.");
  const units = await repo.listUnitsForEdit(ids);
  if (units.length !== ids.length || units.some((unit) => unit.status !== "in_stock")) {
    throw new ValidationError("Bu birim artık stokta değil; sayfayı yenileyin.");
  }
  if (new Set(units.map((unit) => unit.product_id)).size !== 1) {
    throw new ValidationError("Birlikte düzenlenen birimler aynı modelden olmalı.");
  }
  return { ids, product: units[0].products ?? {} };
}

async function writeUnits(ids, values) {
  const updated = await repo.updateInStockUnits(ids, values);
  if (updated.length !== ids.length) {
    throw new ValidationError("Bazı birimler güncellenemedi; sayfayı yenileyip tekrar deneyin.");
  }
  return { count: updated.length };
}

export async function updateUnit(input) {
  const { ids, product } = await shelfUnits(input?.unitIds);
  const built = buildUnitUpdate(input, {
    category: product.category,
    serialPolicy: product.serial_policy,
    collapsed: ids.length > 1,
    today: todayInClinic(),
  });
  if (built.error) throw new ValidationError(built.error);
  return writeUnits(ids, built.values);
}

// The database trigger (007/008) lets only an admin change it and logs the old and new price.
export async function correctUnitPurchasePrice(input) {
  const amount = input?.amount;
  const problem = purchasePriceError(amount);
  if (problem) throw new ValidationError(problem);
  const { ids } = await shelfUnits(input?.unitIds);
  return writeUnits(ids, { purchase_price: Math.round(amount * 100) / 100 });
}
