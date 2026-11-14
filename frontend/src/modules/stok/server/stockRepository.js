import "server-only";
import { createClient } from "@/lib/supabase/server";

// Stock reads, made as the signed-in user so RLS (active staff at aal2) decides what comes back.
// Each function is one query; the service puts the pieces together.

const SUMMARY_COLUMNS =
  "product_id, brand_name, name, category, type, unit, serial_policy, sale_price, min_stock, in_stock, stock_level, boxes, cartons, total_batteries";

function check({ data, error }) {
  if (error) throw error;
  return data ?? [];
}

// Active models from stock_summary, either one group or the given ids (search results), by brand then name.
export async function listSummaryRows({ category, productIds }) {
  if (productIds && !productIds.length) return [];
  const supabase = await createClient();
  let query = supabase.from("stock_summary").select(SUMMARY_COLUMNS).eq("active", true);
  if (category) query = query.eq("category", category);
  if (productIds) query = query.in("product_id", productIds);
  return check(await query.order("brand_name").order("name").order("product_id"));
}

// stock_summary has no brand id or GTIN, so they come from products.
export async function listProductDetails(productIds) {
  if (!productIds.length) return [];
  const supabase = await createClient();
  return check(await supabase.from("products").select("id, brand_id, gtin").in("id", productIds));
}

// All photo rows of the models, oldest first; the service keeps the first one per model.
export async function listPhotos(productIds) {
  if (!productIds.length) return [];
  const supabase = await createClient();
  return check(
    await supabase.from("product_photos").select("product_id, storage_path").in("product_id", productIds).order("id")
  );
}

// Sides of the units on the shelf, for the "Sağ 2 · Sol 1" split. Only devices and receivers ask.
export async function listInStockSides(productIds) {
  if (!productIds.length) return [];
  const supabase = await createClient();
  return check(
    await supabase.from("stock_units").select("product_id, ear_side").in("product_id", productIds).eq("status", "in_stock")
  );
}

// The units of one model that are on the shelf, with where they came from.
export async function listInStockUnits(productId) {
  const supabase = await createClient();
  return check(
    await supabase
      .from("stock_units")
      .select(
        "id, serial_no, ear_side, production_date, wsa_code, purchase_price, receipt_id, created_at, stock_receipts(received_on, invoice_no, suppliers(name))"
      )
      .eq("product_id", productId)
      .eq("status", "in_stock")
      .order("id")
  );
}

// Models that need attention: none left, or at / under their minimum.
export async function listAlertRows() {
  const supabase = await createClient();
  return check(
    await supabase
      .from("stock_summary")
      .select("product_id, brand_name, name, category, in_stock, stock_level")
      .eq("active", true)
      .in("stock_level", ["out", "low"])
      .order("stock_level", { ascending: false })
      .order("brand_name")
      .order("name")
  );
}

// "%" and "_" typed by the user are literal characters, not wildcards.
export function escapeLike(text) {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

// Candidate models for a text search: active products whose model name, or whose brand name, contains the
// word. Brand and model name come back too, so the service can check the remaining words without another query.
// Two queries instead of one .or(): an or() filter cannot reach into the embedded brands table.
export async function findProductsByWord(word) {
  const supabase = await createClient();
  const pattern = `%${escapeLike(word)}%`;
  const columns = "id, name, brands!inner(name)";
  const [byName, byBrand] = await Promise.all([
    supabase.from("products").select(columns).eq("active", true).ilike("name", pattern).limit(200),
    supabase.from("products").select(columns).eq("active", true).ilike("brands.name", pattern).limit(200),
  ]);
  const rows = [...check(byName), ...check(byBrand)];
  return rows.map((row) => ({ id: row.id, name: row.name, brandName: row.brands?.name ?? "" }));
}

export async function findProductIdsByGtin(gtins) {
  if (!gtins.length) return [];
  const supabase = await createClient();
  const rows = check(await supabase.from("products").select("id").eq("active", true).in("gtin", gtins));
  return rows.map((row) => row.id);
}

// The model of the shelf unit with this exact serial number, or null. Sold or removed units do not count:
// the page lists what is in stock.
export async function findProductIdBySerial(serial) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_units")
    .select("product_id")
    .eq("serial_no", serial)
    .eq("status", "in_stock")
    .maybeSingle();
  if (error) throw error;
  return data?.product_id ?? null;
}

// Serial numbers from the list that some unit (in any state) already carries: the database keeps them
// unique for life, so a sold device's number cannot come back as a new unit. Asked in chunks of 100 so the
// request address stays short even for a 500-unit entry.
export async function findExistingSerials(serials) {
  const found = [];
  if (!serials.length) return found;
  const supabase = await createClient();
  for (let start = 0; start < serials.length; start += 100) {
    const chunk = serials.slice(start, start + 100);
    const rows = check(await supabase.from("stock_units").select("serial_no").in("serial_no", chunk));
    found.push(...rows.map((row) => row.serial_no));
  }
  return found;
}

// Product, receipt and units in one database transaction (010_stock_screen.sql): all or nothing.
export async function createStockReceipt({ product, receipt, units }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_stock_receipt", {
    p_product: product,
    p_receipt: receipt,
    p_units: units,
  });
  if (error) throw error;
  return data;
}

// Units leave the stock with a reason in one transaction (010_stock_screen.sql): all of them or none.
export async function removeStockUnits({ unitIds, reason, note }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_stock_units", {
    p_unit_ids: unitIds,
    p_reason: reason,
    p_note: note,
  });
  if (error) throw error;
  return data;
}
