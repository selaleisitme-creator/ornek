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
export function collapseUnits(units) {
  const rows = [];
  const merged = new Map();
  for (const unit of units) {
    if (unit.serialNo) {
      rows.push({ ...unit, count: 1 });
      continue;
    }
    const key = [unit.receiptId ?? "opening", unit.earSide ?? "", unit.purchasePrice ?? ""].join("|");
    const existing = merged.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      const row = { ...unit, count: 1 };
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
