import "server-only";
import { createClient } from "@/lib/supabase/server";

// Reads and writes behind the sale wizard and the patient history's sale buttons, as the signed-in user so RLS (active
// staff) decides. A sale and its follow-up touch several tables, so they go through one database function each (016).

function check({ data, error }) {
  if (error) throw error;
  return data ?? [];
}

export async function listPaymentMethods() {
  const supabase = await createClient();
  return check(await supabase.from("payment_methods").select("code, name").eq("active", true).neq("code", "unspecified").order("sort_order"));
}

export async function listSiteLinks() {
  const supabase = await createClient();
  return check(await supabase.from("links").select("id, name, url, system_key").not("system_key", "is", null).eq("active", true));
}

export async function listServices() {
  const supabase = await createClient();
  return check(await supabase.from("services").select("id, category, name, price").eq("active", true).order("category").order("name"));
}

// Models of one group that have something on the shelf, with both prices (stock_summary, 012).
export async function listGroupModels(category) {
  const supabase = await createClient();
  return check(
    await supabase
      .from("stock_summary")
      .select("product_id, brand_name, name, type, serial_policy, sale_price, wholesale_price, in_stock")
      .eq("category", category)
      .eq("active", true)
      .gt("in_stock", 0)
      .order("brand_name")
      .order("name")
  );
}

export async function listWarrantyMonths(productIds) {
  if (!productIds.length) return [];
  const supabase = await createClient();
  return check(await supabase.from("products").select("id, warranty_months").in("id", productIds));
}

const UNIT_COLUMNS =
  "id, serial_no, ear_side, status, product_id, products(name, category, sale_price, wholesale_price, warranty_months, brands(name))";

export async function listModelUnits(productId) {
  const supabase = await createClient();
  return check(
    await supabase.from("stock_units").select(UNIT_COLUMNS).eq("product_id", productId).eq("status", "in_stock").order("created_at").order("id")
  );
}

export async function findUnitBySerial(serial) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("stock_units").select(UNIT_COLUMNS).eq("serial_no", serial).maybeSingle();
  if (error) throw error;
  return data;
}

export async function findProductsByGtin(gtins) {
  const supabase = await createClient();
  return check(await supabase.from("products").select("id, category").in("gtin", gtins).eq("active", true));
}

export async function createSale({ sale, items, payments, tasks }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_sale", { p_sale: sale, p_items: items, p_payments: payments, p_tasks: tasks });
  if (error) throw error;
  return data;
}

export async function updateSaleFollowup(saleId, { items, invoiceNo, tasks }) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_sale_followup", {
    p_sale_id: saleId,
    p_items: items,
    p_invoice_no: invoiceNo,
    p_tasks: tasks,
  });
  if (error) throw error;
}

// What is still owed on one sale (sales_overview, 007), and whom it belongs to.
export async function getSaleBalance(saleId) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales_overview")
    .select("sale_id, sale_kind, patient_id, patient_remaining, sgk_remaining")
    .eq("sale_id", saleId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// One payment row; sale_payments_guard (008) refuses one above what is owed.
export async function insertPayment(saleId, row) {
  const supabase = await createClient();
  const { error } = await supabase.from("sale_payments").insert({ sale_id: saleId, ...row });
  if (error) throw error;
}

// The items of one sale with what the follow-up form shows, checked against the patient.
export async function getSaleForFollowup(saleId) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sales")
    .select(
      `id, patient_id, sale_kind, sale_date, invoice_mode,
       invoices(id, invoice_no),
       sale_tasks(link_id, links(system_key)),
       sale_items!sale_id(id, uts_report_no, warranty_start, warranty_end, invoice_id,
         stock_units!stock_unit_id(serial_no, products(name, category, brands(name))), services(name))`
    )
    .eq("id", saleId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
