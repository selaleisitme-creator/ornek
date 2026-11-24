// Pure rules for the "Cihaz ve takip bilgileri" window (docs/faz-2-cihaz-takip-plani.md): which devices the patient
// uses now, and what the follow-up, replacement and legacy-device forms may send. The window runs them for instant
// feedback; the server runs them again before it writes, because Server Actions can be called without the window.
import { parseScan } from "@/lib/gs1";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const DEVICE_EAR_SIDES = [
  { value: "right", label: "Sağ kulak" },
  { value: "left", label: "Sol kulak" },
  { value: "both", label: "İki kulak" },
];

export const REPLACEMENT_REASONS = [
  { value: "warranty", label: "Garanti değişimi" },
  { value: "service", label: "Servis değişimi" },
];

const SIDES = new Set(DEVICE_EAR_SIDES.map((option) => option.value));
const REASONS = new Set(REPLACEMENT_REASONS.map((option) => option.value));

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function text(value, max) {
  const cleaned = String(value ?? "").trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, max) : null;
}

function dateOrNull(value) {
  const cleaned = String(value ?? "").trim();
  return cleaned || null;
}

function isDate(value) {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function deviceName(unit) {
  const product = unit?.products;
  if (!product) return null;
  return [product.brands?.name, product.name].filter(Boolean).join(" ");
}

// The hearing aids the patient has now, one per sale item: the sold unit, or the newest replacement in its chain
// (ordered by id, as sale_item_current_unit does). Items returned with a refund are left out.
//   sales:        listSales rows (sale_items with stock_units, refunds)
//   replacements: listReplacements rows (sale_item_id, new_unit)
export function currentDevices(sales, replacements) {
  const devices = [];
  for (const sale of sales ?? []) {
    for (const item of sale.sale_items ?? []) {
      const sold = item.stock_units;
      if (sold?.products?.category !== "device") continue;
      if ((item.refunds ?? []).some((refund) => refund.returns_device)) continue;
      const chain = (replacements ?? []).filter((row) => row.sale_item_id === item.id).sort((a, b) => a.id - b.id);
      const unit = chain.length ? chain[chain.length - 1].new_unit : sold;
      devices.push({
        saleItemId: item.id,
        saleDate: sale.sale_date,
        legacy: sale.sale_kind === "legacy",
        name: deviceName(unit) ?? deviceName(sold),
        serial: unit?.serial_no ?? null,
        brandId: unit?.products?.brand_id ?? sold.products.brand_id ?? null,
        earSide: item.ear_side ?? unit?.ear_side ?? null,
        warrantyStart: item.warranty_start ?? sale.sale_date,
        warrantyEnd: item.warranty_end ?? null,
      });
    }
  }
  return devices.sort((a, b) => String(b.saleDate).localeCompare(String(a.saleDate)) || b.saleItemId - a.saleItemId);
}

// ---------------------------------------------------------------------------
// Follow-up fields: adaptation start, and per device its side and warranty end
// ---------------------------------------------------------------------------

// input: { adaptationStart: "YYYY-MM-DD" | "", devices: [{ saleItemId, earSide, warrantyEnd }] }
// current: currentDevices(...) of the same patient; today: "YYYY-MM-DD" in Istanbul.
// → { error } or { adaptationStart, items: [{ saleItemId, values: { ear_side, warranty_end } }] } with only what changed.
export function buildFollowupUpdate(input, { current, today }) {
  const adaptationStart = dateOrNull(input?.adaptationStart);
  if (adaptationStart && !isDate(adaptationStart)) return { error: "Adaptasyon başlangıcını kontrol edin." };
  if (adaptationStart && adaptationStart > today) return { error: "Adaptasyon başlangıcı bugünden sonra olamaz." };

  const byId = new Map((current ?? []).map((device) => [device.saleItemId, device]));
  const items = [];
  for (const row of input?.devices ?? []) {
    const device = byId.get(positiveId(row?.saleItemId));
    if (!device) return { error: "Cihaz bulunamadı; sayfayı yenileyin." };

    const earSide = row.earSide || null;
    if (earSide && !SIDES.has(earSide)) return { error: "Kulak tarafını seçin." };
    const warrantyEnd = dateOrNull(row.warrantyEnd);
    if (warrantyEnd && !isDate(warrantyEnd)) return { error: "Garanti bitişini kontrol edin." };
    if (warrantyEnd && device.warrantyStart && warrantyEnd < device.warrantyStart) {
      return { error: `${device.name ?? "Cihaz"}: garanti bitişi garanti başlangıcından önce olamaz.` };
    }

    const values = {};
    if (earSide !== (device.earSide ?? null)) values.ear_side = earSide;
    if (warrantyEnd !== (device.warrantyEnd ?? null)) values.warranty_end = warrantyEnd;
    if (Object.keys(values).length) items.push({ saleItemId: device.saleItemId, values });
  }
  return { adaptationStart, items };
}

// ---------------------------------------------------------------------------
// Serial numbers: a GS1 label gives its (21) serial, anything else is the serial as typed
// ---------------------------------------------------------------------------

export function serialFromScan(value) {
  const scan = parseScan(String(value ?? ""));
  return text(scan.serial ?? scan.raw, 60);
}

// ---------------------------------------------------------------------------
// Replacement
// ---------------------------------------------------------------------------

// input: { saleItemId, unitId } for a unit on the shelf, or { saleItemId, productId, serialNo, earSide } for one the
// manufacturer sent; plus reason, replacedOn, note, warrantyEnd.
// device: the current device of that sale item (currentDevices). → { error } or { args } for replace_device.
export function buildReplaceArgs(input, { device, today }) {
  if (!device) return { error: "Değiştirilecek cihazı seçin." };
  const unitId = positiveId(input?.unitId);
  const productId = positiveId(input?.productId);
  const serialNo = text(input?.serialNo, 60);
  if (!unitId) {
    if (!productId) return { error: "Yeni cihazın modelini seçin." };
    if (!serialNo) return { error: "Yeni cihazın seri numarasını girin." };
  }
  if (!REASONS.has(input?.reason)) return { error: "Değişim nedenini seçin." };
  const replacedOn = dateOrNull(input?.replacedOn) ?? today;
  if (!isDate(replacedOn)) return { error: "Değişim tarihini kontrol edin." };
  if (replacedOn > today) return { error: "Değişim tarihi bugünden sonra olamaz." };
  if (device.saleDate && replacedOn < device.saleDate) return { error: "Değişim tarihi satış tarihinden önce olamaz." };
  const warrantyEnd = dateOrNull(input?.warrantyEnd);
  if (warrantyEnd && !isDate(warrantyEnd)) return { error: "Yeni garanti bitişini kontrol edin." };
  if (warrantyEnd && device.warrantyStart && warrantyEnd < device.warrantyStart) {
    return { error: "Yeni garanti bitişi garanti başlangıcından önce olamaz." };
  }
  const earSide = SIDES.has(input?.earSide) ? input.earSide : device.earSide ?? null;

  return {
    args: {
      saleItemId: device.saleItemId,
      newUnit: unitId ? { id: unitId } : { product_id: productId, serial_no: serialNo, ear_side: earSide },
      reason: input.reason,
      replacedOn,
      note: text(input?.note, 500),
      warrantyEnd,
    },
  };
}

// ---------------------------------------------------------------------------
// Legacy device (sold before the panel)
// ---------------------------------------------------------------------------

// input: { productId } or { brandId, modelName, modelType }; serialNo, earSide, saleDate, warrantyEnd, unitPrice (number).
// → { error } or { args } for add_legacy_device.
export function buildLegacyArgs(input, { today }) {
  const productId = positiveId(input?.productId);
  const brandId = positiveId(input?.brandId);
  const modelName = text(input?.modelName, 120);
  if (!productId) {
    if (!brandId) return { error: "Markayı seçin." };
    if (!modelName) return { error: "Model adını yazın ya da listeden seçin." };
  }
  const serialNo = text(input?.serialNo, 60);
  if (!serialNo) return { error: "Seri numarasını girin." };
  const earSide = input?.earSide || null;
  if (!SIDES.has(earSide)) return { error: "Kulak tarafını seçin." };
  const saleDate = dateOrNull(input?.saleDate);
  if (!saleDate || !isDate(saleDate)) return { error: "Satış tarihini girin." };
  if (saleDate > today) return { error: "Satış tarihi bugünden sonra olamaz." };
  const warrantyEnd = dateOrNull(input?.warrantyEnd);
  if (warrantyEnd && !isDate(warrantyEnd)) return { error: "Garanti bitişini kontrol edin." };
  if (warrantyEnd && warrantyEnd < saleDate) return { error: "Garanti bitişi satış tarihinden önce olamaz." };
  const price = input?.unitPrice;
  const hasPrice = price !== null && price !== undefined && price !== "";
  if (hasPrice && !(typeof price === "number" && Number.isFinite(price) && price >= 0)) return { error: "Satış tutarı geçersiz." };

  return {
    args: {
      product: productId ? { id: productId } : { brand_id: brandId, name: modelName, type: text(input?.modelType, 120) },
      unit: { serial_no: serialNo, ear_side: earSide },
      sale: { sale_date: saleDate, warranty_end: warrantyEnd, unit_price: hasPrice ? Math.round(price * 100) / 100 : 0 },
    },
  };
}
