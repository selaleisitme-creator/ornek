import "server-only";
import { buildBulkPriceArgs, previewPriceChange } from "../stockRules";
import * as repo from "./priceRepository";
import { ValidationError } from "./errors";

// Bulk sale price update and its undo (Faz 1 plan 4.4 item 5). Only the sale price (decision 4).

const NOTHING_CHANGES = "Fiyatlar zaten bu değerde; değişiklik yapılmadı.";
const BATCH_NAMES_SHOWN = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toModel(row) {
  return {
    id: row.id,
    brandName: row.brands?.name ?? "",
    name: row.name,
    category: row.category,
    salePrice: Number(row.sale_price),
    gtin: row.gtin,
  };
}

const byBrandThenName = (a, b) =>
  a.brandName.localeCompare(b.brandName, "tr") || a.name.localeCompare(b.name, "tr") || a.id - b.id;

// All active models for the picker, by brand then name.
export async function getPriceModels() {
  const rows = await repo.listActiveModels();
  return rows.map(toModel).sort(byBrandThenName);
}

// The newest bulk batch for the undo strip, or null. Whether it was already undone is not recorded; an undo
// is itself a batch, so after an undo the strip shows the undo (and "Geri al" would re-apply the prices).
export async function getLastPriceBatch() {
  const latest = await repo.getLatestProductBatch();
  if (!latest) return null;
  const rows = await repo.listBatchProducts(latest.batch_id);
  return {
    batchId: latest.batch_id,
    changedAt: latest.changed_at,
    count: rows.length,
    names: rows.slice(0, BATCH_NAMES_SHOWN).map((row) => row.products?.name ?? "").filter(Boolean),
  };
}

function modelLabel(row) {
  return [row.brandName, row.name].filter(Boolean).join(" ");
}

// Recomputed here with the database's current prices and the same rule as the preview: a zero or negative
// result is refused with the models named, before the database is asked (it would refuse the whole batch too).
export async function applyBulkPrices(input) {
  const built = buildBulkPriceArgs(input);
  if (built.error) throw new ValidationError(built.error);
  const { productIds, mode, value, roundTo } = built.args;

  const rows = await repo.listModelsByIds(productIds);
  if (rows.length !== productIds.length || rows.some((row) => !row.active)) {
    throw new ValidationError("Seçilen modellerden bazıları bulunamadı ya da pasif; sayfayı yenileyin.");
  }

  const { rows: preview, counts } = previewPriceChange(rows.map(toModel), { mode, value, roundTo });
  if (counts.bad > 0) {
    const names = preview.filter((row) => row.status === "bad").map(modelLabel).slice(0, 3).join(", ");
    throw new ValidationError(`Yeni fiyat sıfır ya da eksi oluyor (${names}). Hiçbir fiyat değiştirilmedi.`);
  }
  if (counts.ok === 0) throw new ValidationError(NOTHING_CHANGES);

  const batchId = await repo.updatePricesBulk(built.args);
  if (!batchId) throw new ValidationError(NOTHING_CHANGES);
  return { batchId, changed: counts.ok };
}

// Only the batch the strip shows may be undone: a stale screen must not undo an older batch by accident.
export async function undoLastPriceBatch(batchId) {
  const id = String(batchId ?? "");
  if (!UUID_RE.test(id)) throw new ValidationError("Geri alınacak fiyat güncellemesi bulunamadı.");
  const latest = await repo.getLatestProductBatch();
  if (!latest || latest.batch_id !== id) {
    throw new ValidationError("Bu fiyat güncellemesi artık son işlem değil; sayfayı yenileyin.");
  }
  const restored = await repo.undoPriceBatch(id);
  return { restored: Number(restored) || 0 };
}
