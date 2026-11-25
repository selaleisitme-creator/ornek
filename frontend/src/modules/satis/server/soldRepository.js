import "server-only";
import { createClient } from "@/lib/supabase/server";

// Reads and writes behind Stok > Satılan ürünler, as the signed-in user so RLS (active staff) decides.

function check({ data, error }) {
  if (error) throw error;
  return data ?? [];
}

// Sold goods (items with a stock unit), newest first. Legacy sales (before the panel) are left out: they took no money
// and cannot be refunded. The inner joins keep only rows that have a unit and a sale.
const SOLD_COLUMNS = `id, unit_price, quantity, uts_report_no, cost_at_sale, warranty_end, ear_side,
  sales!inner(id, sale_no, sale_date, sale_kind, patient_id, customer_name, patients(full_name),
    sale_payments(amount, payer, payment_methods(code, name))),
  stock_units!stock_unit_id!inner(id, serial_no, production_date, wsa_code, products(name, category, brands(name))),
  refunds(id, amount, refunded_on, returns_device, payment_method)`;

export async function listSoldItems(limit) {
  const supabase = await createClient();
  return check(
    await supabase.from("sale_items").select(SOLD_COLUMNS).neq("sales.sale_kind", "legacy").order("id", { ascending: false }).limit(limit)
  );
}

export async function getSoldItem(id) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("sale_items").select(SOLD_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listItemValues(ids) {
  if (!ids.length) return [];
  const supabase = await createClient();
  return check(await supabase.from("sale_item_values").select("sale_item_id, net_value").in("sale_item_id", ids));
}

// What is still owed on each sale (patient share and expected SGK), for hiding "Tahsilat ekle" when nothing is left.
export async function listSaleBalances(saleIds) {
  if (!saleIds.length) return [];
  const supabase = await createClient();
  return check(
    await supabase.from("sales_overview").select("sale_id, patient_remaining, sgk_remaining").in("sale_id", saleIds)
  );
}

export async function updateUnit(id, values) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("stock_units").update(values).eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function updateItemUts(id, utsNo) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("sale_items").update({ uts_report_no: utsNo || null }).eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function createRefund({ saleItemId, amount, method, reason, returnsDevice, refundedOn }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_refund", {
    p_sale_item_id: saleItemId,
    p_amount: amount,
    p_payment_method: method,
    p_reason: reason,
    p_returns_device: returnsDevice,
    p_refunded_on: refundedOn,
  });
  if (error) throw error;
  return data;
}
