import "server-only";
import { createClient } from "@/lib/supabase/server";

function check({ data, error, count }) {
  if (error) throw error;
  return count ?? data ?? [];
}

const APPOINTMENT_COLUMNS = `
  id, patient_id, kind_id, starts_at, ends_at, status, cancelled_at,
  referral_source_id, request_id, notes,
  patients(id, patient_no, full_name, phone, birth_date, address, record_type, referral_source_id),
  appointment_kinds(id, key, name),
  referral_sources(id, name)
`;

export async function listAppointments(startIso, endIso) {
  const supabase = await createClient();
  return check(
    await supabase
      .from("appointments")
      .select(APPOINTMENT_COLUMNS)
      .gte("starts_at", startIso)
      .lt("starts_at", endIso)
      .order("starts_at")
  );
}

export async function listPatientOverviews(patientIds) {
  if (!patientIds.length) return [];
  const supabase = await createClient();
  return check(
    await supabase
      .from("patient_overview")
      .select("patient_id, devices, warranty_end, status, last_appointment, next_appointment")
      .in("patient_id", patientIds)
  );
}

export async function listAppointmentKinds() {
  const supabase = await createClient();
  return check(
    await supabase
      .from("appointment_kinds")
      .select("id, key, name")
      .eq("active", true)
      .order("sort_order")
      .order("id")
  );
}

export async function listReferralSources() {
  const supabase = await createClient();
  return check(
    await supabase
      .from("referral_sources")
      .select("id, name")
      .eq("active", true)
      .order("sort_order")
      .order("id")
  );
}

export async function listOpenRequests() {
  const supabase = await createClient();
  return check(
    await supabase
      .from("appointment_requests")
      .select("id, full_name, phone, email, appointment_date, appointment_time, status")
      .eq("status", "new")
      .order("appointment_date")
      .order("appointment_time")
  );
}

export async function searchPatients(term, digits) {
  const supabase = await createClient();
  const byName = await supabase
    .from("patients")
    .select("id, patient_no, full_name, phone, birth_date, address, record_type, referral_source_id")
    .eq("active", true)
    .ilike("full_name", `%${term}%`)
    .order("full_name")
    .limit(20);
  if (byName.error) throw byName.error;

  let byPhone = { data: [] };
  if (digits.length >= 3) {
    byPhone = await supabase
      .from("patients")
      .select("id, patient_no, full_name, phone, birth_date, address, record_type, referral_source_id")
      .eq("active", true)
      .ilike("phone", `%${digits}%`)
      .order("full_name")
      .limit(20);
    if (byPhone.error) throw byPhone.error;
  }

  const rows = [...(byName.data ?? []), ...(byPhone.data ?? [])];
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()].slice(0, 20);
  if (!unique.length) return [];

  const overview = await supabase
    .from("patient_overview")
    .select("patient_id, devices, warranty_end, status, last_appointment, next_appointment")
    .in("patient_id", unique.map((row) => row.id));
  if (overview.error) throw overview.error;

  const details = new Map((overview.data ?? []).map((row) => [row.patient_id, row]));
  return unique.map((patient) => ({ ...patient, overview: details.get(patient.id) ?? null }));
}

export async function saveAppointment(input) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_appointment", {
    p_appointment_id: input.appointmentId,
    p_patient_id: input.patientId,
    p_patient_name: input.patientName,
    p_patient_phone: input.patientPhone,
    p_kind_id: input.kindId,
    p_starts_at: input.startsAt,
    p_duration_minutes: input.durationMinutes,
    p_status: input.status,
    p_referral_source_id: input.referralSourceId,
    p_notes: input.notes,
  });
  if (error) throw error;
  return data;
}

export async function updateAppointmentStatus(id, status, cancelledAt) {
  const supabase = await createClient();
  let query = supabase
    .from("appointments")
    .update({
      status,
      cancelled_at: status === "cancelled" ? cancelledAt : null,
    });
  query = query.eq("id", id);
  if (status !== "cancelled") query = query.neq("status", "cancelled");
  const { data, error } = await query
    .select("id, status, cancelled_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const validation = new Error(
      status === "cancelled" ? "Randevu bulunamadı." : "İptal edilmiş randevuda katılım işlemi yapılamaz."
    );
    validation.name = "ValidationError";
    throw validation;
  }
  return data;
}

export async function convertRequest(input) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_appointment_request", {
    p_request_id: input.requestId,
    p_kind_id: input.kindId,
    p_starts_at: input.startsAt,
    p_duration_minutes: input.durationMinutes,
    p_notes: input.notes,
  });
  if (error) throw error;
  return data;
}

export async function rejectRequest(id) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointment_requests")
    .update({ status: "rejected" })
    .eq("id", id)
    .eq("status", "new")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const validation = new Error("Talep daha önce yanıtlanmış.");
    validation.name = "ValidationError";
    throw validation;
  }
}

export async function claimReminder(appointmentId, offset) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_appointment_reminder", {
    p_appointment_id: appointmentId,
    p_reminder_offset: offset,
  });
  if (error) throw error;
  return data;
}

export async function recordReminderSent(appointmentId, offset) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_appointment_reminder_sent", {
    p_appointment_id: appointmentId,
    p_reminder_offset: offset,
  });
  if (error) throw error;
}

export async function insertAppointmentContact(appointmentId, patientId) {
  const supabase = await createClient();
  const { error } = await supabase.from("patient_contacts").insert({
    patient_id: patientId,
    channel: "whatsapp",
    purpose: "general",
    appointment_id: appointmentId,
  });
  if (error) throw error;
}

export async function getAppointmentPatientId(id) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("appointments").select("patient_id").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.patient_id ?? null;
}

export async function listAppointmentsForReminders(fromIso, untilIso) {
  const supabase = await createClient();
  return check(
    await supabase
      .from("appointments")
      .select("id, patient_id, starts_at, status, patients(full_name, phone), appointment_kinds(name)")
      .eq("status", "waiting")
      .gte("starts_at", fromIso)
      .lt("starts_at", untilIso)
      .order("starts_at")
  );
}

export async function getReminderSettings() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select("reminders_enabled, remind_3d, remind_1d, remind_1h")
    .eq("id", 1)
    .single();
  if (error) throw error;
  return data;
}
