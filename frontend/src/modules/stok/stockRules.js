import { normalizeGtin, parseScan } from "@/lib/gs1";

// Stock rules shared by the browser and the server: no database, no "server-only", so Vitest can check them.

// URL key ↔ database category ↔ label. The first one is the default group and stays out of the address.
export const STOCK_GROUPS = [
  { key: "cihaz", category: "device", label: "İşitme cihazları", unitWord: "cihaz" },
  { key: "receiver", category: "receiver", label: "Receiver", unitWord: "adet" },
  { key: "sarj", category: "charger", label: "Şarj", unitWord: "adet" },
  { key: "pil", category: "battery", label: "Piller", unitWord: "paket" },
  { key: "dome", category: "dome", label: "Dome", unitWord: "adet" },
];

export function stockGroupByKey(key) {
  return STOCK_GROUPS.find((group) => group.key === key) ?? STOCK_GROUPS[0];
}

export function stockGroupByCategory(category) {
  return STOCK_GROUPS.find((group) => group.category === category) ?? STOCK_GROUPS[0];
}

// Only devices and receivers are fitted to one ear, so only they show the Sağ / Sol split.
export function hasEarSides(category) {
  return category === "device" || category === "receiver";
}

const EAR_SIDE_LABELS = { right: "Sağ", left: "Sol", both: "İki kulak", none: "Taraf yok" };

export function earSideLabel(side) {
  return EAR_SIDE_LABELS[side] ?? "Belirtilmedi";
}

export function countEarSides(sides) {
  const counts = { right: 0, left: 0, both: 0 };
  for (const side of sides) if (side in counts) counts[side] += 1;
  return counts;
}

// "Sağ 2 · Sol 1"; sides with no unit are left out, and "Taraf yok" / unknown are not worth a column entry.
export function formatEarSides(counts) {
  return ["right", "left", "both"]
    .filter((side) => counts?.[side] > 0)
    .map((side) => `${EAR_SIDE_LABELS[side]} ${counts[side]}`)
    .join(" · ");
}

export const STOCK_LEVELS = {
  ok: { label: "Stokta", tone: "ok" },
  low: { label: "Azalıyor", tone: "warn" },
  out: { label: "Bitti", tone: "danger" },
};

export function stockLevelInfo(level) {
  return STOCK_LEVELS[level] ?? STOCK_LEVELS.ok;
}

// Batteries are counted in packs; boxes, cartons and the battery total come ready from stock_summary
// (whole boxes and cartons only), so they are shown only when the model defines that packaging.
export function formatStock(model) {
  const count = Number(model.inStock) || 0;
  if (model.unit !== "pack") return `${count} adet`;

  const parts = [`${count} paket`];
  if (Number(model.boxes) > 0) parts.push(`${model.boxes} kutu`);
  if (Number(model.cartons) > 0) parts.push(`${model.cartons} koli`);
  if (model.totalBatteries !== null && model.totalBatteries !== undefined) parts.push(`${model.totalBatteries} pil`);
  return parts.join(" · ");
}

// Models grouped under their brand, in the order they arrive (the repository sorts by brand, then name).
export function groupByBrand(models) {
  const groups = new Map();
  for (const model of models) {
    const key = model.brandId ?? model.brandName;
    if (!groups.has(key)) groups.set(key, { brandId: model.brandId, brandName: model.brandName, models: [] });
    groups.get(key).models.push(model);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    modelCount: group.models.length,
    unitCount: group.models.reduce((sum, model) => sum + (Number(model.inStock) || 0), 0),
  }));
}

// "Bernafon · 4 model · 13 cihaz". Search results can mix groups under one brand; then "adet" is the honest word.
export function brandHeading(group) {
  const categories = new Set(group.models.map((model) => model.category));
  const unitWord = categories.size === 1 ? stockGroupByCategory([...categories][0]).unitWord : "adet";
  return `${group.brandName} · ${group.modelCount} model · ${group.unitCount} ${unitWord}`;
}

export function summarizeAlerts(rows) {
  return {
    out: rows.filter((row) => row.stockLevel === "out").length,
    low: rows.filter((row) => row.stockLevel === "low").length,
    items: rows,
  };
}

// Units without a serial number cannot be told apart, so those from the same receipt with the same side and
// price become one "n adet" row. Serial-numbered units always keep their own row.
// Every row keeps the ids of all its units (unitIds): editing or removing "3 of 8 adet" needs real unit ids.
export function collapseUnits(units) {
  const rows = [];
  const merged = new Map();
  for (const unit of units) {
    if (unit.serialNo) {
      rows.push({ ...unit, count: 1, unitIds: [unit.id] });
      continue;
    }
    const key = [unit.receiptId ?? "opening", unit.earSide ?? "", unit.purchasePrice ?? ""].join("|");
    const existing = merged.get(key);
    if (existing) {
      existing.count += 1;
      existing.unitIds.push(unit.id);
    } else {
      const row = { ...unit, count: 1, unitIds: [unit.id] };
      merged.set(key, row);
      rows.push(row);
    }
  }
  return rows;
}

// "Bilgi Medikal · F-123", or "Açılış stoğu" for stock that was on the shelf before the panel (no receipt).
export function receiptLabel(unit) {
  if (!unit.receiptId) return "Açılış stoğu";
  return [unit.supplierName, unit.invoiceNo].filter(Boolean).join(" · ") || "—";
}

// ---------------------------------------------------------------------------
// Address bar
// ---------------------------------------------------------------------------

const DEFAULTS = { grup: STOCK_GROUPS[0].key, gorunum: "tablo" };
const PARAM_ORDER = ["grup", "marka", "ara", "gorunum", "ac"];

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveId(value) {
  const number = Number(first(value));
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// searchParams from Next.js → the stock page's own options. Anything unexpected falls back to the default,
// so a hand-edited address never breaks the page.
export function readStockQuery(params = {}) {
  const ara = String(first(params.ara) ?? "").trim().slice(0, 200);
  return {
    grup: stockGroupByKey(first(params.grup)).key,
    marka: positiveId(params.marka),
    ara: ara || null,
    gorunum: first(params.gorunum) === "kart" ? "kart" : "tablo",
    ac: positiveId(params.ac),
  };
}

// The stock page address with some options changed (null removes one). Defaults are left out, so the plain
// "/stok" and "/stok?grup=cihaz" are never two addresses for the same view.
export function stockHref(query, changes = {}) {
  const merged = { ...query, ...changes };
  const params = new URLSearchParams();
  for (const key of PARAM_ORDER) {
    const value = merged[key];
    if (value === null || value === undefined || value === "" || value === DEFAULTS[key]) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `/stok?${text}` : "/stok";
}

// ---------------------------------------------------------------------------
// Search and scanning
// ---------------------------------------------------------------------------

// What the search box puts in ?ara=. A GS1 scan is written back in bracket form so the server can split it
// again; anything else (a name, a plain serial, a shop barcode) goes as typed.
export function scanToSearchText(scan) {
  if (scan?.gtin) return `(01)${scan.gtin}${scan.serial ? `(21)${scan.serial}` : ""}`;
  return (scan?.raw ?? "").trim();
}

// ?ara= → what to look for. A GS1 label gives an exact GTIN and serial; plain text may be a model name, a
// serial number or a barcode, so it is tried as all three.
export function searchTerms(text) {
  const scan = parseScan(text);
  if (scan.gtin) return { words: [], gtins: gtinVariants(scan.gtin), serial: scan.serial };

  const raw = scan.raw;
  if (!raw) return { words: [], gtins: [], serial: null };
  const isBarcode = /^\d{8,14}$/.test(raw);
  return { words: searchWords(raw), gtins: isBarcode ? gtinVariants(raw) : [], serial: raw };
}

// Turkish-aware case folding: "VIRON", "Viron" and "vıron" all become "viron", because people type the
// dotless and dotted i interchangeably and the database's ilike does not know Turkish rules.
function fold(text) {
  return text.toLocaleLowerCase("tr").replace(/ı/g, "i");
}

// "  Bernafon   alpha " → ["bernafon", "alpha"]; repeated words count once.
export function searchWords(text) {
  return [...new Set(fold(text ?? "").split(/\s+/).filter(Boolean))];
}

// True when every search word appears somewhere in the text (brand + model name), in any order.
export function matchesAllWords(text, words) {
  const haystack = fold(text ?? "");
  return words.every((word) => haystack.includes(word));
}

// A GTIN-13 may be stored as the 14-digit form with a leading zero, and the other way round.
function gtinVariants(code) {
  const short = normalizeGtin(code);
  return short.length === 13 ? [short, `0${short}`] : [short];
}

// ---------------------------------------------------------------------------
// Stock entry ("Stok ekle"). The dialog uses these for instant feedback; the server runs the same checks
// again before it calls create_stock_receipt, because the browser can be bypassed.
// ---------------------------------------------------------------------------

export const MAX_ENTRY_UNITS = 500;

export const SERIAL_POLICIES = [
  { value: "required", label: "Zorunlu" },
  { value: "optional", label: "İsteğe bağlı" },
  { value: "none", label: "Kullanılmıyor" },
];

export function serialPolicyLabel(policy) {
  return SERIAL_POLICIES.find((option) => option.value === policy)?.label ?? "—";
}

// Receivers and domes usually come without a serial number on the box; devices, chargers and battery
// packs carry one.
export function defaultSerialPolicy(category) {
  return category === "receiver" || category === "dome" ? "none" : "required";
}

// "" means "not given": the database stores null, which the unit list shows as "Belirtilmedi".
export const EAR_SIDE_OPTIONS = [
  { value: "", label: "Belirtilmedi" },
  { value: "right", label: "Sağ" },
  { value: "left", label: "Sol" },
  { value: "both", label: "İki kulak" },
  { value: "none", label: "Taraf yok" },
];

// Ways a purchase can be paid. Paynet and installments are how patients pay the clinic, not how the
// clinic pays suppliers, so they are left out.
export const PURCHASE_PAYMENT_CODES = ["cash", "card_pos", "transfer", "other"];

// The same split as create_stock_receipt: every unit gets the total divided and rounded to the kuruş, the
// last one takes the remainder, so the units add up to exactly the total (the cash ledger sums units).
// Worked in whole kuruş so float error cannot shift a cent. 30000 / 7 → six 4285.71 and one 4285.74.
export function splitTotalCost(total, count) {
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(total)) return [];
  const totalKurus = Math.round(total * 100);
  const base = Math.round(totalKurus / count);
  const last = totalKurus - base * (count - 1);
  return [...Array(count - 1).fill(base), last].map((kurus) => kurus / 100);
}

function wholeOrZero(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

// Battery helper: "2 koli + 3 kutu + 4 paket" → packs. Null when boxes or cartons are given but the model
// does not say how many packs a box (or boxes a carton) holds, because then there is nothing to multiply.
export function packsFromPackaging({ cartons, boxes, packs } = {}, { packsPerBox, boxesPerCarton } = {}) {
  const c = wholeOrZero(cartons);
  const b = wholeOrZero(boxes);
  const p = wholeOrZero(packs);
  const perBox = wholeOrZero(packsPerBox);
  const perCarton = wholeOrZero(boxesPerCarton);
  if ((b || c) && !perBox) return null;
  if (c && !perCarton) return null;
  return p + b * perBox + c * perCarton * perBox;
}

// A typed or scanned GTIN → its stored form (13 digits when a GTIN-14 starts with 0). Spaces are ignored;
// letters are an error instead of being dropped, so a mistyped code is never saved as a different one.
export function cleanGtin(text) {
  const compact = String(text ?? "").replace(/\s/g, "");
  if (!compact) return { gtin: null, error: null };
  if (!/^\d+$/.test(compact)) return { gtin: null, error: "GTIN yalnızca rakamlardan oluşmalı." };
  const gtin = normalizeGtin(compact);
  if (gtin.length < 8 || gtin.length > 14) return { gtin: null, error: "GTIN 8 ile 14 hane arasında olmalı." };
  return { gtin, error: null };
}

export function sameGtin(a, b) {
  return Boolean(a && b) && normalizeGtin(a) === normalizeGtin(b);
}

// The first serial number that appears twice in the list (ignoring surrounding spaces), or null.
export function findDuplicateSerial(serials) {
  const seen = new Set();
  for (const serial of serials) {
    const text = String(serial ?? "").trim();
    if (!text) continue;
    if (seen.has(text)) return text;
    seen.add(text);
  }
  return null;
}

function isOptionalWhole(value, { min }) {
  if (value === null || value === undefined || value === "") return true;
  const number = Number(value);
  return Number.isInteger(number) && number >= min;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A new model's fields → the first problem as a Turkish sentence, or null when it can be saved.
export function newModelError(model) {
  if (!Number.isSafeInteger(Number(model?.brandId)) || !(Number(model?.brandId) > 0)) return "Marka seçin.";
  return modelFieldsError(model);
}

// The model fields both "Stok ekle" and "Model düzenle" share (everything but the brand, which is fixed
// once the model exists). model.category must be set: batteries need their pack size.
export function modelFieldsError(model = {}) {
  const name = String(model.name ?? "").trim();
  if (!name) return "Model adı zorunlu.";
  if (name.length > 120) return "Model adı en fazla 120 karakter olabilir.";
  if (!(Number(model.salePrice) > 0)) return "Satış fiyatı sıfırdan büyük olmalı.";
  const gtin = cleanGtin(model.gtin);
  if (gtin.error) return gtin.error;
  if (!isOptionalWhole(model.warrantyMonths, { min: 0 })) return "Garanti süresi ay olarak tam sayı olmalı.";
  if (!isOptionalWhole(model.minStock, { min: 0 })) return "Alt stok eşiği sıfır ya da daha büyük bir tam sayı olmalı.";
  if (!SERIAL_POLICIES.some((option) => option.value === model.serialPolicy)) return "Seri numarası kuralını seçin.";
  if (model.category === "battery") {
    if (!model.packSize || !isOptionalWhole(model.packSize, { min: 1 })) return "Paket içindeki pil adedini girin.";
    if (!isOptionalWhole(model.packsPerBox, { min: 1 })) return "Kutudaki paket sayısı pozitif bir tam sayı olmalı.";
    if (!isOptionalWhole(model.boxesPerCarton, { min: 1 })) return "Kolideki kutu sayısı pozitif bir tam sayı olmalı.";
  }
  return null;
}

// The entry step (units and purchase) → the first problem as a Turkish sentence, or null.
//   units: [{ serialNo, productionDate }], amount: number or null, today: "YYYY-MM-DD" in Istanbul.
export function entryError({ units, serialPolicy, opening, priceMode, amount, paymentMethod, receivedOn, today }) {
  const count = units?.length ?? 0;
  if (count < 1 || count > MAX_ENTRY_UNITS) return `Stok adedi 1 ile ${MAX_ENTRY_UNITS} arasında olmalı.`;

  const serials = units.map((unit) => String(unit.serialNo ?? "").trim());
  if (serialPolicy === "required") {
    const missing = serials.findIndex((serial) => !serial);
    if (missing !== -1) return `Bu modelde seri numarası zorunlu (${missing + 1}. satır boş).`;
  }
  if (serialPolicy === "none" && serials.some(Boolean)) {
    return "Bu model seri numarasız takip ediliyor; seri numarası girmeyin.";
  }
  const duplicate = findDuplicateSerial(serials);
  if (duplicate) return `${duplicate} seri numarası listede iki kez var.`;
  if (serials.some((serial) => serial.length > 60)) return "Seri numarası en fazla 60 karakter olabilir.";

  for (const unit of units) {
    const date = unit.productionDate || "";
    if (date && (!DATE_RE.test(date) || date > today)) return "Üretim tarihi geçerli ve bugünden sonra olmayan bir tarih olmalı.";
  }

  if (priceMode !== "unit" && priceMode !== "total") return "Birim ya da toplam alış tutarını seçin.";
  const hasAmount = amount !== null && amount !== undefined;
  if (hasAmount && !(Number.isFinite(amount) && amount >= 0)) return "Alış tutarı geçersiz.";
  if (!opening) {
    if (!(amount > 0)) return "Alış tutarı sıfırdan büyük olmalı.";
    if (!paymentMethod) return "Alış ödeme şeklini seçin.";
    if (!receivedOn || !DATE_RE.test(receivedOn)) return "Giriş tarihini girin.";
    if (receivedOn > today) return "Giriş tarihi bugünden sonra olamaz.";
  }
  if (priceMode === "total" && amount > 0 && splitTotalCost(amount, count).some((price) => price < 0)) {
    return "Toplam tutar bu kadar birime bölünemeyecek kadar küçük.";
  }
  return null;
}

function text(value, max) {
  const cleaned = String(value ?? "").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function optionalWhole(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

// Money from the browser arrives as a number (MoneyInput parses the Turkish text). Anything else is
// "invalid", kept apart from "not given" so a broken value is never quietly treated as no price.
function toAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : Number.NaN;
}

const EAR_SIDES = new Set(EAR_SIDE_OPTIONS.map((option) => option.value).filter(Boolean));

// The window's input → the three create_stock_receipt arguments, or the first problem in Turkish.
//   existing: the product row read from the database ({ id, category, unit, serial_policy, active }) when an
//             existing model was chosen, so its serial rule comes from the database, not from the browser.
//   today:    "YYYY-MM-DD" in Istanbul.
export function buildStockEntryArgs(input, { existing = null, today }) {
  const isNew = !existing;
  const source = input?.product ?? {};
  const category = isNew ? String(source.category ?? "") : existing.category;
  if (!STOCK_GROUPS.some((group) => group.category === category)) return { error: "Ürün grubunu seçin." };

  const serialPolicy = isNew ? source.serialPolicy : existing.serial_policy;
  if (isNew) {
    const problem = newModelError({ ...source, category });
    if (problem) return { error: problem };
  }

  const raw = input?.receipt ?? {};
  const opening = raw.opening === true;
  const priceMode = raw.priceMode;
  const amount = toAmount(raw.amount);
  const paymentMethod = opening ? null : text(raw.paymentMethod, 40);
  if (paymentMethod && !PURCHASE_PAYMENT_CODES.includes(paymentMethod)) return { error: "Alış ödeme şeklini seçin." };
  const receivedOn = opening ? null : text(raw.receivedOn, 10);

  const sided = hasEarSides(category);
  const rawUnits = Array.isArray(input?.units) ? input.units : [];
  const units = rawUnits.map((unit) => ({
    serial_no: text(unit?.serialNo, 200),
    ear_side: sided && EAR_SIDES.has(unit?.earSide) ? unit.earSide : null,
    production_date: text(unit?.productionDate, 10),
    wsa_code: null, // WSA is filled after the sale (Faz 2), not on the shelf
  }));

  const problem = entryError({
    units: units.map((unit) => ({ serialNo: unit.serial_no, productionDate: unit.production_date })),
    serialPolicy,
    opening,
    priceMode,
    amount,
    paymentMethod,
    receivedOn,
    today,
  });
  if (problem) return { error: problem };

  // Opening stock with no price (or 0): send none, so the database copies the model's purchase price.
  const sentAmount = amount > 0 ? amount : null;
  const receipt = {
    opening,
    supplier_id: opening ? null : Number(raw.supplierId) || null,
    received_on: receivedOn,
    invoice_no: opening ? null : text(raw.invoiceNo, 60),
    payment_method: paymentMethod,
    note: opening ? null : text(raw.note, 500),
    price_mode: priceMode,
    amount: sentAmount,
  };

  let product = { id: existing?.id };
  if (isNew) {
    const battery = category === "battery";
    // The model keeps one unit's price as the suggestion for its next entry.
    const unitPrice = sentAmount === null ? 0 : priceMode === "total" ? splitTotalCost(sentAmount, units.length)[0] : sentAmount;
    product = {
      brand_id: Number(source.brandId),
      category,
      name: String(source.name).trim().replace(/\s+/g, " "),
      type: text(source.type, 120),
      gtin: cleanGtin(source.gtin).gtin,
      package_barcode: text(source.packageBarcode, 60),
      manufacturer_ref: text(source.manufacturerRef, 60),
      unit: battery ? "pack" : "piece",
      pack_size: battery ? optionalWhole(source.packSize) : null,
      packs_per_box: battery ? optionalWhole(source.packsPerBox) : null,
      boxes_per_carton: battery ? optionalWhole(source.boxesPerCarton) : null,
      sale_price: Math.round(Number(source.salePrice) * 100) / 100,
      purchase_price: unitPrice,
      warranty_months: optionalWhole(source.warrantyMonths) ?? 0,
      min_stock: optionalWhole(source.minStock) ?? 0,
      serial_policy: serialPolicy,
    };
  }

  return { args: { product, receipt, units } };
}

// ---------------------------------------------------------------------------
// Editing a model, a unit, photos, and removing stock. The dialogs check these first for instant feedback;
// the server checks them again before it writes, because Server Actions can be called without the dialogs.
// ---------------------------------------------------------------------------

// 1–max distinct positive ids, or null. Ids come from the browser, so anything odd refuses the whole list
// instead of being dropped: removing "some" of what was ticked would be worse than removing nothing.
export function cleanUnitIds(ids, max = MAX_ENTRY_UNITS) {
  if (!Array.isArray(ids) || ids.length < 1) return null;
  const numbers = ids.map(Number);
  if (!numbers.every((id) => Number.isSafeInteger(id) && id > 0)) return null;
  const unique = [...new Set(numbers)];
  return unique.length <= max ? unique : null;
}

// "Model düzenle" input → the products columns this screen may change, or the first problem in Turkish.
// Brand, group, unit and purchase price are left out on purpose: the group decides how the stock is counted,
// and the model's purchase price is only the suggestion for the next entry (Faz 1 decision 4).
//   category: the product's group read from the database, never from the browser.
export function buildModelUpdate(input, { category }) {
  const source = input ?? {};
  const problem = modelFieldsError({ ...source, category });
  if (problem) return { error: problem };

  const battery = category === "battery";
  const values = {
    name: String(source.name).trim().replace(/\s+/g, " "),
    type: text(source.type, 120),
    gtin: cleanGtin(source.gtin).gtin,
    package_barcode: text(source.packageBarcode, 60),
    manufacturer_ref: text(source.manufacturerRef, 60),
    sale_price: Math.round(Number(source.salePrice) * 100) / 100,
    warranty_months: optionalWhole(source.warrantyMonths) ?? 0,
    min_stock: optionalWhole(source.minStock) ?? 0,
    serial_policy: source.serialPolicy,
  };
  if (battery) {
    values.pack_size = optionalWhole(source.packSize);
    values.packs_per_box = optionalWhole(source.packsPerBox);
    values.boxes_per_carton = optionalWhole(source.boxesPerCarton);
  }
  return { values };
}

// Switching the rule to "Zorunlu" does not touch units already on the shelf (the database checks a serial
// only when a unit is written), so the dialog warns how many would then need one before their next edit.
export function serialRuleWarning({ from, to, serialLessCount }) {
  if (to !== "required" || from === "required" || !(serialLessCount > 0)) return null;
  return `Stokta seri numarası olmayan ${serialLessCount} birim var. Bu birimler düzenlenirken seri numarası istenecek.`;
}

// "Birim düzenle" input → the stock_units columns to write, or the first problem in Turkish.
//   collapsed: true when the row stands for several serial-less units ("8 adet"); then only the side and the
//              production date apply to all of them. Serial and WSA code belong to one unit only.
//   today:     "YYYY-MM-DD" in Istanbul.
export function buildUnitUpdate(input, { category, serialPolicy, collapsed, today }) {
  const source = input ?? {};
  const values = {};

  if (hasEarSides(category)) {
    const side = String(source.earSide ?? "");
    if (side && !EAR_SIDES.has(side)) return { error: "Tarafı seçin." };
    values.ear_side = side || null;
  }

  const date = String(source.productionDate ?? "").trim();
  if (date && (!DATE_RE.test(date) || date > today)) {
    return { error: "Üretim tarihi geçerli ve bugünden sonra olmayan bir tarih olmalı." };
  }
  values.production_date = date || null;

  if (!collapsed) {
    const serial = String(source.serialNo ?? "").trim();
    if (serialPolicy === "required" && !serial) return { error: "Bu modelde seri numarası zorunlu." };
    if (serialPolicy === "none" && serial) return { error: "Bu model seri numarasız takip ediliyor; seri numarası girmeyin." };
    if (serial.length > 60) return { error: "Seri numarası en fazla 60 karakter olabilir." };
    values.serial_no = serial || null;

    const wsa = String(source.wsaCode ?? "").trim();
    if (wsa.length > 60) return { error: "WSA kodu en fazla 60 karakter olabilir." };
    values.wsa_code = wsa || null;
  }
  return { values };
}

// numeric(12, 2) in the database: up to 9.999.999.999,99.
export function purchasePriceError(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "Alış fiyatını 7.491,64 biçiminde yazın.";
  if (amount < 0) return "Alış fiyatı eksi olamaz.";
  if (amount >= 1e10) return "Alış fiyatı çok büyük.";
  return null;
}

// Photos are shrunk to WebP in the browser first (resizeImage.js); the limit stays under the Server Action's
// 1 MB request cap, which also has to carry the form fields around the file.
export const PHOTO_TYPES = ["image/webp", "image/jpeg", "image/png"];
export const MAX_PHOTO_BYTES = 1000 * 1000;

export function photoFileError(file) {
  if (!file || typeof file.size !== "number") return "Fotoğraf seçin.";
  if (!PHOTO_TYPES.includes(file.type)) return "Yalnızca JPEG, PNG ya da WebP fotoğraf yüklenebilir.";
  if (file.size === 0) return "Fotoğraf dosyası boş.";
  if (file.size > MAX_PHOTO_BYTES) return "Fotoğraf 1 MB'tan büyük olamaz.";
  return null;
}

// Same list as the stock_removals check in 010_stock_screen.sql.
export const REMOVAL_REASONS = [
  { value: "entry_error", label: "Hatalı giriş" },
  { value: "damaged_lost", label: "Hasarlı / kayıp" },
  { value: "returned_to_supplier", label: "Tedarikçiye iade" },
  { value: "other", label: "Diğer" },
];

// "Stok sil" input → the remove_stock_units arguments, or the first problem in Turkish.
export function buildRemovalArgs(input) {
  const unitIds = cleanUnitIds(input?.unitIds, MAX_ENTRY_UNITS);
  if (!unitIds) return { error: `Silinecek birimleri seçin (en fazla ${MAX_ENTRY_UNITS}).` };
  const reason = String(input?.reason ?? "");
  if (!REMOVAL_REASONS.some((option) => option.value === reason)) return { error: "Silme nedenini seçin." };
  const note = String(input?.note ?? "").trim();
  if (note.length > 500) return { error: "Not en fazla 500 karakter olabilir." };
  // "Diğer" says nothing by itself; the note is the only record of why the unit left the shelf.
  if (reason === "other" && !note) return { error: "\"Diğer\" seçildiğinde not yazın." };
  return { args: { unitIds, reason, note: note || null } };
}

// The unit ids picked in "Stok sil": counts is { [rowId]: how many of that row }. A serial row counts 0 or 1,
// a collapsed "8 adet" row 0–8; the units within a collapsed row are interchangeable, so the first n are taken.
export function pickedUnitIds(rows, counts) {
  const ids = [];
  for (const row of rows ?? []) {
    const wanted = Math.floor(Number(counts?.[row.id]) || 0);
    const unitIds = row.unitIds ?? [];
    ids.push(...unitIds.slice(0, Math.min(Math.max(wanted, 0), unitIds.length)));
  }
  return ids;
}

// The unit row whose serial number was scanned or typed (surrounding spaces ignored), or null.
export function rowBySerial(rows, serial) {
  const wanted = String(serial ?? "").trim();
  if (!wanted) return null;
  return (rows ?? []).find((row) => row.serialNo && row.serialNo.trim() === wanted) ?? null;
}
