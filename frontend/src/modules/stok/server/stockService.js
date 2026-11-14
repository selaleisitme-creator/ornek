import "server-only";
import {
  findProductIdBySerial,
  findProductIdsByGtin,
  findProductsByWord,
  listAlertRows,
  listInStockSides,
  listInStockUnits,
  listPhotos,
  listProductDetails,
  listSummaryRows,
} from "./stockRepository";
import { getProductForEdit, listProductPhotos } from "./catalogRepository";
import {
  collapseUnits,
  countEarSides,
  groupByBrand,
  hasEarSides,
  matchesAllWords,
  searchTerms,
  stockGroupByKey,
  summarizeAlerts,
} from "../stockRules";

// Shapes the stock page: models of the chosen group (or the search results) grouped by brand, the brand
// chips, the alerts box and, for the one open model, its units and what its edit windows need. Read-only.

// product-photos is a public bucket, so the browser can load the file straight from Storage.
function photoUrl(path) {
  if (!path) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-photos/${encoded}`;
}

function toModel(row, details, photoPath) {
  return {
    productId: row.product_id,
    brandId: details?.brand_id ?? null,
    brandName: row.brand_name,
    name: row.name,
    category: row.category,
    type: row.type,
    unit: row.unit,
    serialPolicy: row.serial_policy,
    salePrice: row.sale_price,
    minStock: row.min_stock,
    inStock: Number(row.in_stock) || 0,
    stockLevel: row.stock_level,
    boxes: row.boxes,
    cartons: row.cartons,
    totalBatteries: row.total_batteries,
    gtin: details?.gtin ?? null,
    photoUrl: photoUrl(photoPath),
    earSides: null,
  };
}

// stock_summary rows → page models with brand id, GTIN, first photo and (devices, receivers) the side split.
async function buildModels(summaryRows) {
  const ids = summaryRows.map((row) => row.product_id);
  const sidedIds = summaryRows.filter((row) => hasEarSides(row.category)).map((row) => row.product_id);
  const [details, photos, sides] = await Promise.all([
    listProductDetails(ids),
    listPhotos(ids),
    listInStockSides(sidedIds),
  ]);

  const detailsById = new Map(details.map((row) => [row.id, row]));
  const firstPhoto = new Map();
  for (const photo of photos) if (!firstPhoto.has(photo.product_id)) firstPhoto.set(photo.product_id, photo.storage_path);
  const sidesById = new Map();
  for (const unit of sides) {
    if (!sidesById.has(unit.product_id)) sidesById.set(unit.product_id, []);
    sidesById.get(unit.product_id).push(unit.ear_side);
  }

  return summaryRows.map((row) => {
    const model = toModel(row, detailsById.get(row.product_id), firstPhoto.get(row.product_id));
    if (hasEarSides(row.category)) model.earSides = countEarSides(sidesById.get(row.product_id) ?? []);
    return model;
  });
}

// Brand chips are built from the models themselves, so a brand with no active device never shows up.
function brandChips(models) {
  const brands = new Map();
  for (const model of models) if (model.brandId && !brands.has(model.brandId)) brands.set(model.brandId, model.brandName);
  return [...brands].map(([id, name]) => ({ id, name }));
}

async function loadGroup(query) {
  const group = stockGroupByKey(query.grup);
  const models = await buildModels(await listSummaryRows({ category: group.category }));
  const brands = group.category === "device" ? brandChips(models) : [];
  const filtered = brands.length && query.marka ? models.filter((model) => model.brandId === query.marka) : models;
  return { group, brands, models: filtered, matchedProductId: null };
}

// A scan or typed text → matching models from every group. When a shelf unit's serial number matched, its
// model is opened, so the scanned unit is on screen right away.
// Text is matched word by word: every word must appear in the brand or model name ("bernafon alpha" finds
// Bernafon's "Alpha 5 MNR T"). The database narrows by the longest word, the rest is checked here.
async function findIdsByWords(words) {
  if (!words.length) return [];
  const longest = words.reduce((best, word) => (word.length > best.length ? word : best));
  const candidates = await findProductsByWord(longest);
  return candidates.filter((row) => matchesAllWords(`${row.brandName} ${row.name}`, words)).map((row) => row.id);
}

async function loadSearch(query) {
  const terms = searchTerms(query.ara);
  const [byName, byGtin, bySerial] = await Promise.all([
    findIdsByWords(terms.words),
    findProductIdsByGtin(terms.gtins),
    terms.serial ? findProductIdBySerial(terms.serial) : null,
  ]);
  const ids = [...new Set([bySerial, ...byGtin, ...byName].filter(Boolean))];
  const models = await buildModels(await listSummaryRows({ productIds: ids }));
  return { group: null, brands: [], models, matchedProductId: bySerial };
}

function toUnit(row) {
  const receipt = row.stock_receipts;
  return {
    id: row.id,
    serialNo: row.serial_no,
    earSide: row.ear_side,
    productionDate: row.production_date,
    wsaCode: row.wsa_code,
    purchasePrice: row.purchase_price,
    receiptId: row.receipt_id,
    // Opening stock has no receipt; the day it was typed in is the closest thing to an entry date.
    receivedOn: receipt?.received_on ?? row.created_at,
    invoiceNo: receipt?.invoice_no ?? null,
    supplierName: receipt?.suppliers?.name ?? null,
  };
}

function toNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

// The "Model düzenle" fields and every photo of the open model. Loaded for that one model only, so the
// list itself stays as light as before.
async function loadOpenDetails(productId) {
  const [product, photos] = await Promise.all([getProductForEdit(productId), listProductPhotos(productId)]);
  if (!product) return null;
  return {
    productId: product.id,
    category: product.category,
    unit: product.unit,
    name: product.name,
    type: product.type ?? "",
    gtin: product.gtin ?? "",
    packageBarcode: product.package_barcode ?? "",
    manufacturerRef: product.manufacturer_ref ?? "",
    salePrice: toNumber(product.sale_price),
    warrantyMonths: product.warranty_months ?? "",
    minStock: product.min_stock ?? "",
    serialPolicy: product.serial_policy,
    packSize: product.pack_size ?? "",
    packsPerBox: product.packs_per_box ?? "",
    boxesPerCarton: product.boxes_per_carton ?? "",
    photos: photos.map((photo) => ({ id: photo.id, url: photoUrl(photo.storage_path) })),
  };
}

export async function getStockView(query) {
  const [alertRows, listing] = await Promise.all([listAlertRows(), query.ara ? loadSearch(query) : loadGroup(query)]);

  const openProductId = query.ac ?? listing.matchedProductId;
  const openModel = listing.models.find((model) => model.productId === openProductId) ?? null;
  const isShown = Boolean(openModel);
  const [unitRows, openDetails] = isShown
    ? await Promise.all([listInStockUnits(openProductId), loadOpenDetails(openProductId)])
    : [[], null];
  const units = collapseUnits(unitRows.map(toUnit));

  return {
    group: listing.group,
    brands: listing.brands,
    brandGroups: groupByBrand(listing.models),
    modelCount: listing.models.length,
    openProductId: isShown ? openProductId : null,
    openModel,
    openDetails,
    openUnits: units,
    alerts: summarizeAlerts(
      alertRows.map((row) => ({
        productId: row.product_id,
        brandName: row.brand_name,
        name: row.name,
        category: row.category,
        inStock: Number(row.in_stock) || 0,
        stockLevel: row.stock_level,
      }))
    ),
  };
}
