import "server-only";
import { createClient } from "@/lib/supabase/server";

// Home page reads, made as the signed-in user so RLS decides what comes back. One query per function;
// homeService puts them together. The chart and table totals come from the database functions of
// 011_home_summaries.sql, so only their few result rows travel, however many records the clinic has.

function check({ data, error, count }) {
  if (error) throw error;
  return count ?? data ?? [];
}

// Newest sold items first, for the "Satılan ürünler" window.
export async function listSoldItems(limit) {
  const supabase = await createClient();
  return check(
    await supabase
      .from("sale_report")
      .select("sale_item_id, sale_id, sale_no, sale_date, device, serial_no, operation, net_value, refunded")
      .order("sale_date", { ascending: false })
      .order("sale_item_id", { ascending: false })
      .limit(limit)
  );
}

// Newest attended visits with patient name and kind, for the "Gelen hastalar" window.
export async function listArrivedVisits(limit) {
  const supabase = await createClient();
  return check(
    await supabase
      .from("appointments")
      .select("id, starts_at, patient_id, patients(full_name), appointment_kinds(name)")
      .eq("status", "attended")
      .order("starts_at", { ascending: false })
      .limit(limit)
  );
}

// ---- Chart and table totals (011_home_summaries.sql) ----------------------------------------------------

async function rpc(name, args) {
  const supabase = await createClient();
  return check(await supabase.rpc(name, args));
}

export const salesByMonth = (fromDate) => rpc("home_sales_monthly", { p_from: fromDate });
export const salesTotal = async () => (await rpc("home_sales_total"))[0] ?? { amount: 0, sale_count: 0 };
export const visitsByMonth = (fromDate) => rpc("home_visits_monthly", { p_from: fromDate });
export const paymentMethodCounts = () => rpc("home_payment_methods");
export const referralCounts = () => rpc("home_referral_counts");

// ---- Suggestions ----------------------------------------------------------------------------------------

export async function listStockAlerts() {
  const supabase = await createClient();
  return check(
    await supabase
      .from("stock_summary")
      .select("product_id, brand_name, name, category, in_stock, min_stock, stock_level")
      .eq("active", true)
      .in("stock_level", ["out", "low"])
      .order("in_stock")
      .order("brand_name")
  );
}

export async function countNewWebRequests() {
  const supabase = await createClient();
  return check(await supabase.from("appointment_requests").select("id", { count: "exact", head: true }).eq("status", "new"));
}

// Today's appointments whose time has passed and that are still waiting.
export async function countUnmarkedAppointments(dayStartIso, nowIso) {
  const supabase = await createClient();
  return check(
    await supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("status", "waiting")
      .gte("starts_at", dayStartIso)
      .lt("starts_at", nowIso)
  );
}

const OVERVIEW_COLUMNS = "patient_id, full_name, phone, devices, warranty_end, adaptation_start, status";

export async function listMaintenanceDue() {
  const supabase = await createClient();
  return check(
    await supabase
      .from("patient_overview")
      .select(OVERVIEW_COLUMNS)
      .eq("active", true)
      .eq("status", "maintenance_due")
      .order("adaptation_start")
      .limit(50)
  );
}

// Patients whose device sale falls in a follow-up window, or whose warranty ends or ended recently.
export async function listFollowUpCandidates({ saleFrom, saleTo, warrantyFrom, warrantyTo }) {
  const supabase = await createClient();
  return check(
    await supabase
      .from("patient_overview")
      .select(OVERVIEW_COLUMNS)
      .eq("active", true)
      .eq("has_device", true)
      .or(
        `and(adaptation_start.gte.${saleFrom},adaptation_start.lte.${saleTo}),and(warranty_end.gte.${warrantyFrom},warranty_end.lte.${warrantyTo})`
      )
      .limit(200)
  );
}

// Appointment days (not cancelled) of the given patients from a date on, for the follow-up check.
export async function listAppointmentDays(patientIds, fromIso) {
  if (!patientIds.length) return [];
  const supabase = await createClient();
  return check(
    await supabase
      .from("appointments")
      .select("patient_id, starts_at")
      .in("patient_id", patientIds)
      .neq("status", "cancelled")
      .gte("starts_at", fromIso)
  );
}

// Sold devices and chargers still missing a production date or a WSA code.
export async function listUnitsMissingTracking() {
  const supabase = await createClient();
  return check(
    await supabase
      .from("stock_units")
      .select("id, serial_no, production_date, wsa_code, products!inner(name, category, brands(name))")
      .eq("status", "sold")
      .in("products.category", ["device", "charger"])
      .or("production_date.is.null,wsa_code.is.null")
      .order("id", { ascending: false })
      .limit(50)
  );
}

export async function getBackupSettings() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("backup_enabled").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getLastBackupRun(status) {
  const supabase = await createClient();
  let query = supabase.from("backup_runs").select("status, started_at, finished_at");
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listInvoiceLinks() {
  const supabase = await createClient();
  return check(await supabase.from("links").select("name, url, system_key").eq("active", true));
}

export async function listPendingSgk() {
  const supabase = await createClient();
  return check(await supabase.from("receivables").select("sale_id, sgk_remaining").gt("sgk_remaining", 0));
}

// ---- Referral sources -----------------------------------------------------------------------------------

export async function listReferralSources() {
  const supabase = await createClient();
  return check(
    await supabase.from("referral_sources").select("id, name, visible").eq("active", true).order("sort_order").order("id")
  );
}

export async function updateReferralSource(id, fields) {
  const supabase = await createClient();
  const { error } = await supabase.from("referral_sources").update(fields).eq("id", id);
  if (error) throw error;
}

export async function insertReferralSource(name, sortOrder) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("referral_sources")
    .insert({ name, sort_order: sortOrder })
    .select("id, name, visible")
    .single();
  if (error) throw error;
  return data;
}

export async function maxReferralSortOrder() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("referral_sources")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.sort_order ?? 0;
}
