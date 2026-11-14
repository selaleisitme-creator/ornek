import "server-only";
import { createClient } from "@/lib/supabase/server";

// Bulk sale prices: the two RPCs and the reads behind the "Fiyat güncelle" window and the undo strip.
// Run as the signed-in user, so RLS (active staff at aal2) applies; price_changes is written only by triggers.

function check({ data, error }) {
  if (error) throw error;
  return data ?? [];
}

const MODEL_COLUMNS = "id, name, category, sale_price, gtin, active, brands(name)";

// Every active model of every group, for the picker. Sorted by brand in the service: PostgREST cannot order
// the parent rows by a column of the embedded brand.
export async function listActiveModels() {
  const supabase = await createClient();
  return check(await supabase.from("products").select(MODEL_COLUMNS).eq("active", true).order("name").order("id"));
}

// The chosen models as they are now, so the server previews with the database's prices, not the browser's.
export async function listModelsByIds(ids) {
  if (!ids.length) return [];
  const supabase = await createClient();
  return check(await supabase.from("products").select(MODEL_COLUMNS).in("id", ids));
}

// One batch id for all changes, or null when no price would change (010_stock_screen.sql).
export async function updatePricesBulk({ productIds, mode, value, roundTo }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_prices_bulk", {
    p_product_ids: productIds,
    p_mode: mode,
    p_value: value,
    p_round_to: roundTo,
  });
  if (error) throw error;
  return data ?? null;
}

// All or nothing; refuses when a price in the batch was changed again later (008_design_gaps.sql).
export async function undoPriceBatch(batchId) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_price_batch", { p_batch_id: batchId });
  if (error) throw error;
  return data;
}

// The newest model sale price change that belongs to a batch. Single edits ("Model düzenle") and service
// prices have no batch or no product, so they never show up here.
export async function getLatestProductBatch() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("price_changes")
    .select("batch_id, changed_at")
    .not("batch_id", "is", null)
    .not("product_id", "is", null)
    .eq("price_field", "sale")
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// The models a batch changed, with their names for the strip.
export async function listBatchProducts(batchId) {
  const supabase = await createClient();
  return check(
    await supabase
      .from("price_changes")
      .select("product_id, products(name, brands(name))")
      .eq("batch_id", batchId)
      .not("product_id", "is", null)
      .eq("price_field", "sale")
      .order("id")
  );
}
