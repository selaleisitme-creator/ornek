import "server-only";
import { createClient } from "@/lib/supabase/server";
import { escapeLike } from "./stockRepository";

// Brands, models, suppliers and payment methods for the stock entry window. Run as the signed-in user, so
// RLS (active staff at aal2) decides what may be read and inserted.

function check({ data, error }) {
  if (error) throw error;
  return data ?? [];
}

export async function listActiveBrands() {
  const supabase = await createClient();
  return check(await supabase.from("brands").select("id, name").eq("active", true).order("name"));
}

export async function listActiveSuppliers() {
  const supabase = await createClient();
  return check(await supabase.from("suppliers").select("id, name").eq("active", true).order("name"));
}

export async function listPaymentMethods(codes) {
  const supabase = await createClient();
  return check(
    await supabase.from("payment_methods").select("code, name").eq("active", true).in("code", codes).order("sort_order")
  );
}

const PRODUCT_COLUMNS =
  "id, brand_id, name, type, gtin, package_barcode, serial_policy, unit, pack_size, packs_per_box, boxes_per_carton, sale_price, purchase_price, brands(name)";

// Active models of one group, optionally of one brand, by name.
export async function listProducts({ category, brandId }) {
  const supabase = await createClient();
  let query = supabase.from("products").select(PRODUCT_COLUMNS).eq("active", true).eq("category", category);
  if (brandId) query = query.eq("brand_id", brandId);
  return check(await query.order("name").order("id"));
}

// Shelf counts come from stock_summary, which already counts in_stock units per model.
export async function listInStockCounts(productIds) {
  if (!productIds.length) return [];
  const supabase = await createClient();
  return check(await supabase.from("stock_summary").select("product_id, in_stock").in("product_id", productIds));
}

// The facts a stock entry must take from the database, never from the browser.
export async function getProduct(id) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, category, unit, serial_policy, active")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Exact name, any letter case ("phonak" finds "Phonak"); the like wildcards in the name are taken literally.
async function findByName(table, name, { activeOnly }) {
  const supabase = await createClient();
  let query = supabase.from(table).select("id, name").ilike("name", escapeLike(name));
  if (activeOnly) query = query.eq("active", true);
  const { data, error } = await query.order("id").limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

// Brands are unique by name whatever their state, so an inactive one counts too.
export function findBrandByName(name) {
  return findByName("brands", name, { activeOnly: false });
}

export function findSupplierByName(name) {
  return findByName("suppliers", name, { activeOnly: true });
}

export async function insertBrand(name) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("brands").insert({ name }).select("id, name").single();
  if (error) throw error;
  return data;
}

export async function insertSupplier(name) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("suppliers").insert({ name }).select("id, name").single();
  if (error) throw error;
  return data;
}
