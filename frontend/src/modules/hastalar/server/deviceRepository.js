import "server-only";
import { createClient } from "@/lib/supabase/server";

// Reads and writes behind the "Cihaz ve takip bilgileri" window, as the signed-in user so RLS (active staff) decides.
// The two writes that touch several tables go through one database function each (015_patient_devices.sql).

function check({ data, error }) {
  if (error) throw error;
  return data ?? [];
}

// Side and warranty end of one sale item. The sale_items trigger (003) refuses a change of device or service,
// and the table refuses a warranty end before its start.
export async function updateSaleItem(id, values) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("sale_items").update(values).eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

// A unit found by its serial number, with its model, to tell "on the shelf" from "already handed out".
export async function findUnitBySerial(serial) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_units")
    .select("id, serial_no, status, ear_side, products(id, name, category, brands(name))")
    .eq("serial_no", serial)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Every hearing aid model, inactive ones included (a legacy device may be of a model no longer sold).
export async function listDeviceModels() {
  const supabase = await createClient();
  return check(
    await supabase.from("products").select("id, name, type, brand_id, active").eq("category", "device").order("name").order("id")
  );
}

export async function listBrands() {
  const supabase = await createClient();
  return check(await supabase.from("brands").select("id, name").eq("active", true).order("name"));
}

export async function replaceDevice({ saleItemId, newUnit, reason, replacedOn, note, warrantyEnd }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("replace_device", {
    p_sale_item_id: saleItemId,
    p_new_unit: newUnit,
    p_reason: reason,
    p_replaced_on: replacedOn,
    p_note: note,
    p_warranty_end: warrantyEnd,
  });
  if (error) throw error;
  return data;
}

export async function addLegacyDevice(patientId, { product, unit, sale }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_legacy_device", {
    p_patient_id: patientId,
    p_product: product,
    p_unit: unit,
    p_sale: sale,
  });
  if (error) throw error;
  return data;
}
