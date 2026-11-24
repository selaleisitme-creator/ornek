import "server-only";
import { createClient } from "@/lib/supabase/server";

// Hastalar reads and writes, made as the signed-in user so RLS (active staff) decides. Patients are never
// deleted: there is no delete rule on the table, and sales, appointments and the ledger point at them.
// "Hasta kaydını sil" sets active = false instead.

function check({ data, error, count }) {
  if (error) throw error;
  return count ?? data ?? [];
}

// ---- List ------------------------------------------------------------------------------------------------

const LIST_COLUMNS =
  "patient_id, patient_no, full_name, phone, record_type, registered_on, devices, adaptation_start, adaptation_end, status, last_appointment, next_appointment";

// One filter for both the list and its tab counts, so the numbers on the buttons always match the rows.
function applyTab(query, tab) {
  if (tab === "aday") return query.eq("record_type", "candidate");
  query = query.eq("record_type", "patient");
  if (tab === "aktif") return query.eq("status", "active");
  if (tab === "adaptasyon") return query.eq("status", "adaptation");
  return query;
}

// search: { term, digits } from patientRules (already cleaned of PostgREST syntax).
function applySearch(query, search) {
  if (!search?.term) return query;
  const like = `*${search.term}*`;
  const parts = [`full_name.ilike.${like}`, `patient_no.ilike.${like}`, `devices.ilike.${like}`];
  if (search.digits) parts.push(`phone.ilike.*${search.digits}*`);
  return query.or(parts.join(","));
}

export async function listPatients({ tab, search, limit }) {
  const supabase = await createClient();
  let query = supabase.from("patient_overview").select(LIST_COLUMNS, { count: "exact" }).eq("active", true);
  query = applySearch(applyTab(query, tab), search);
  const { data, error, count } = await query
    .order("registered_on", { ascending: false })
    .order("patient_id", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function countPatients(tab) {
  const supabase = await createClient();
  const query = supabase.from("patient_overview").select("patient_id", { count: "exact", head: true }).eq("active", true);
  return check(await applyTab(query, tab));
}

// ---- Card ------------------------------------------------------------------------------------------------

const PATIENT_COLUMNS =
  "id, patient_no, full_name, phone, birth_date, address, record_type, registered_on, whatsapp_consent_at, referral_source_id, adaptation_start_manual, active, referral_sources(name)";

export async function getPatient(id) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("patients").select(PATIENT_COLUMNS).eq("id", id).eq("active", true).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getOverview(id) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patient_overview")
    .select(
      "patient_id, status, has_device, right_device, left_device, devices, warranty_end, adaptation_start, adaptation_end, last_appointment, next_appointment, last_contact"
    )
    .eq("patient_id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listNotes(patientId) {
  const supabase = await createClient();
  return check(
    await supabase
      .from("patient_notes")
      .select("id, title, body, noted_on, created_at")
      .eq("patient_id", patientId)
      .order("noted_on", { ascending: false })
      .order("id", { ascending: false })
  );
}

// Sales with their items and payments. The !column hints pick the direct foreign key: stock_units can also
// be reached through device_replacements, which would make PostgREST refuse an unhinted embed.
// Item values after discount and VAT come from sale_item_values.
export async function listSales(patientId) {
  const supabase = await createClient();
  return check(
    await supabase
      .from("sales")
      .select(
        `id, sale_no, sale_kind, sale_date,
         sale_payments(amount, payer, payment_methods(name)),
         sale_items!sale_id(id, quantity, ear_side, warranty_end, service_id,
           services(name),
           stock_units!stock_unit_id(id, serial_no, ear_side, products(name, category, brands(name))),
           refunds(id, refunded_on, returns_device))`
      )
      .eq("patient_id", patientId)
      .order("sale_date", { ascending: false })
      .order("id", { ascending: false })
  );
}

export async function listItemValues(saleIds) {
  if (!saleIds.length) return [];
  const supabase = await createClient();
  return check(await supabase.from("sale_item_values").select("sale_item_id, net_value").in("sale_id", saleIds));
}

export async function listReplacements(saleItemIds) {
  if (!saleItemIds.length) return [];
  const supabase = await createClient();
  return check(
    await supabase
      .from("device_replacements")
      .select(
        `id, sale_item_id, replaced_on, reason,
         old_unit:stock_units!old_stock_unit_id(serial_no),
         new_unit:stock_units!new_stock_unit_id(serial_no, products(name, brands(name)))`
      )
      .in("sale_item_id", saleItemIds)
      .order("replaced_on")
      .order("id")
  );
}

export async function listReferralSources() {
  const supabase = await createClient();
  return check(await supabase.from("referral_sources").select("id, name").eq("active", true).order("sort_order").order("id"));
}

// ---- National ID (encrypted by the server, 007_integrity_fixes.sql / 008_design_gaps.sql) ----------------

export async function hasNationalId(patientId) {
  const supabase = await createClient();
  const rows = check(await supabase.rpc("national_id_presence", { p_patient_ids: [patientId] }));
  // A setof bigint function comes back as plain numbers; accept the object form too, to be safe.
  return rows.some((row) => Number(typeof row === "object" && row !== null ? Object.values(row)[0] : row) === Number(patientId));
}

export async function nationalIdLast4(patientId) {
  const supabase = await createClient();
  const rows = check(await supabase.rpc("national_id_last4", { p_patient_ids: [patientId] }));
  return rows[0]?.last4 ?? null;
}

export async function saveNationalId(patientId, encrypted, last4) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_national_id", { p_patient_id: patientId, p_encrypted: encrypted, p_last4: last4 });
  if (error) throw error;
}

// Reads the encrypted ID and writes the audit row in one step (reveal_national_id).
export async function revealNationalId(patientId) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reveal_national_id", { p_patient_id: patientId });
  if (error) throw error;
  return data;
}

// ---- Writes ----------------------------------------------------------------------------------------------

export async function insertPatient(fields) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("patients").insert(fields).select("id").single();
  if (error) throw error;
  return data;
}

export async function updatePatient(id, fields) {
  const supabase = await createClient();
  const { error } = await supabase.from("patients").update(fields).eq("id", id).eq("active", true);
  if (error) throw error;
}

export async function insertNote(fields) {
  const supabase = await createClient();
  const { error } = await supabase.from("patient_notes").insert(fields);
  if (error) throw error;
}

export async function insertContact(fields) {
  const supabase = await createClient();
  const { error } = await supabase.from("patient_contacts").insert(fields);
  if (error) throw error;
}
