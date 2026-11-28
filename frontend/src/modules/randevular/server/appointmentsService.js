import "server-only";
import { clinicDateTimeToIso, formatDateTime } from "@/lib/dates";
import * as repo from "./appointmentsRepository";

const DURATIONS = [15, 30, 45, 60, 90];
const STATUSES = ["waiting", "attended", "no_show", "cancelled"];
const STATUS_LABELS = {
  waiting: "Bekliyor",
  attended: "Geldi",
  no_show: "Gelmedi",
  cancelled: "İptal edildi",
};
const REMINDER_SETTINGS = [
  { key: "1h", minutes: 60, setting: "remind_1h", label: "1 saat kala · hatırlatma" },
  { key: "1d", minutes: 1440, setting: "remind_1d", label: "1 gün kala · hatırlatma" },
  { key: "3d", minutes: 4320, setting: "remind_3d", label: "3 gün kala · hatırlatma" },
];

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

function monthRange(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month ?? ""));
  if (!match) throw new ValidationError("Takvim ayını kontrol edin.");
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new ValidationError("Takvim ayını kontrol edin.");

  const firstDay = `${match[1]}-${match[2]}-01`;
  const next = new Date(Date.UTC(year, monthNumber, 1));
  const nextMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const from = clinicDateTimeToIso(firstDay, "00:00");
  const until = clinicDateTimeToIso(nextMonth, "00:00");
  if (!from || !until) throw new ValidationError("Takvim ayını kontrol edin.");
  return { from, until };
}

function appointmentView(row, overview) {
  const patient = row.patients ?? {};
  const [day, month, year, time] = formatDateTime(row.starts_at).match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}:\d{2})$/)?.slice(1) ?? [];
  return {
    id: row.id,
    patientId: row.patient_id,
    patientNo: patient.patient_no ?? null,
    patientName: patient.full_name ?? "Hasta kaydı bulunamadı",
    phone: patient.phone ?? "",
    birthDate: patient.birth_date ?? null,
    address: patient.address ?? null,
    patientRecordType: patient.record_type ?? null,
    patientReferralSourceId: patient.referral_source_id ?? null,
    devices: overview?.devices ?? null,
    warrantyEnd: overview?.warranty_end ?? null,
    patientStatus: overview?.status ?? null,
    lastAppointment: overview?.last_appointment ?? null,
    nextAppointment: overview?.next_appointment ?? null,
    kindId: row.kind_id,
    kindName: row.appointment_kinds?.name ?? "Randevu",
    sourceId: row.referral_source_id,
    sourceName: row.referral_sources?.name ?? "Kaynak belirtilmedi",
    date: day && month && year ? `${year}-${month}-${day}` : "",
    time: time ?? "",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    duration: Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000),
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    cancelledAt: row.cancelled_at,
    requestId: row.request_id,
    notes: row.notes ?? "",
  };
}

async function appointmentViews(rows) {
  const patientIds = [...new Set(rows.map((row) => row.patient_id))];
  const overviews = await repo.listPatientOverviews(patientIds);
  const byPatient = new Map(overviews.map((row) => [row.patient_id, row]));
  return rows.map((row) => appointmentView(row, byPatient.get(row.patient_id)));
}

export async function getScreenData(month) {
  const range = monthRange(month);
  const [rows, kinds, sources, requests] = await Promise.all([
    repo.listAppointments(range.from, range.until),
    repo.listAppointmentKinds(),
    repo.listReferralSources(),
    repo.listOpenRequests(),
  ]);
  return {
    appointments: await appointmentViews(rows),
    kinds,
    sources,
    requests,
  };
}

export async function getAppointmentsForMonth(month) {
  const { from, until } = monthRange(month);
  return appointmentViews(await repo.listAppointments(from, until));
}

function cleanQuery(value) {
  return String(value ?? "").replace(/[%_,()\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export async function searchAppointmentPatients(query) {
  const term = cleanQuery(query);
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  const patients = await repo.searchPatients(term, digits);
  return patients.map((patient) => ({
    id: patient.id,
    patientNo: patient.patient_no,
    name: patient.full_name,
    phone: patient.phone,
    birthDate: patient.birth_date,
    address: patient.address,
    recordType: patient.record_type,
    referralSourceId: patient.referral_source_id,
    devices: patient.overview?.devices ?? null,
    warrantyEnd: patient.overview?.warranty_end ?? null,
    status: patient.overview?.status ?? null,
    lastAppointment: patient.overview?.last_appointment ?? null,
    nextAppointment: patient.overview?.next_appointment ?? null,
  }));
}

function positiveId(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new ValidationError(`${label} kaydını kontrol edin.`);
  return id;
}

function normalizedPhone(value, required) {
  const text = String(value ?? "").trim();
  if (!text) {
    if (required) throw new ValidationError("Yeni randevu adayı için telefon numarası girin.");
    return "";
  }
  const digits = text.replace(/\D/g, "");
  let number = text.startsWith("+") ? digits : digits.startsWith("00") ? digits.slice(2) : digits;
  if (!text.startsWith("+") && !digits.startsWith("00")) {
    if (number.length === 11 && number.startsWith("0")) number = `90${number.slice(1)}`;
    else if (number.length === 10) number = `90${number}`;
  }
  if (!/^[1-9]\d{7,14}$/.test(number)) {
    throw new ValidationError("Ülke koduyla birlikte geçerli bir telefon numarası girin.");
  }
  return `+${number}`;
}

function saveInput(input, appointmentId = null) {
  const patientId = positiveId(input.patientId, "Hasta");
  const patientName = String(input.patientName ?? "").trim().replace(/\s+/g, " ");
  if (!patientId && !patientName) throw new ValidationError("Hasta adını yazın veya kayıtlı hastayı seçin.");
  if (patientName.length > 120) throw new ValidationError("Hasta adı en fazla 120 karakter olabilir.");

  const patientPhone = normalizedPhone(input.phone, true);
  const kindId = positiveId(input.kindId, "Randevu türü");
  const durationMinutes = Number(input.duration);
  if (!DURATIONS.includes(durationMinutes)) throw new ValidationError("Süre 15, 30, 45, 60 veya 90 dakika olmalı.");
  const status = String(input.status ?? "waiting");
  if (!STATUSES.includes(status)) throw new ValidationError("Randevu durumunu kontrol edin.");
  const startsAt = clinicDateTimeToIso(input.date, input.time);
  if (!startsAt) throw new ValidationError("Tarih ve saati kontrol edin.");

  return {
    appointmentId: positiveId(appointmentId, "Randevu"),
    patientId,
    patientName,
    patientPhone,
    kindId,
    startsAt,
    durationMinutes,
    status,
    referralSourceId: positiveId(input.referralSourceId, "Kaynak"),
    notes: String(input.notes ?? "").trim().slice(0, 500) || null,
  };
}

export async function saveAppointment(input, appointmentId = null) {
  return repo.saveAppointment(saveInput(input, appointmentId));
}

export async function setAttendance(id, status) {
  const appointmentId = positiveId(id, "Randevu");
  if (!["attended", "no_show"].includes(status)) throw new ValidationError("Katılım durumunu kontrol edin.");
  return repo.updateAppointmentStatus(appointmentId, status, null);
}

export async function cancelAppointment(id, now = new Date()) {
  const appointmentId = positiveId(id, "Randevu");
  return repo.updateAppointmentStatus(appointmentId, "cancelled", now.toISOString());
}

export async function convertAppointmentRequest(requestId, input) {
  const id = String(requestId ?? "");
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) {
    throw new ValidationError("Randevu talebini kontrol edin.");
  }
  const kindId = positiveId(input.kindId, "Randevu türü");
  const durationMinutes = Number(input.duration);
  if (!DURATIONS.includes(durationMinutes)) throw new ValidationError("Süre 15, 30, 45, 60 veya 90 dakika olmalı.");
  const startsAt = clinicDateTimeToIso(input.date, input.time);
  if (!startsAt) throw new ValidationError("Tarih ve saati kontrol edin.");
  return repo.convertRequest({
    requestId: id,
    kindId,
    startsAt,
    durationMinutes,
    notes: String(input.notes ?? "").trim().slice(0, 500) || null,
  });
}

export async function rejectAppointmentRequest(id) {
  const requestId = String(id ?? "");
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(requestId)) {
    throw new ValidationError("Randevu talebini kontrol edin.");
  }
  return repo.rejectRequest(requestId);
}

export async function getDueReminder(now = new Date()) {
  const settings = await repo.getReminderSettings();
  if (!settings.reminders_enabled) return null;

  const upcoming = await repo.listAppointmentsForReminders(
    now.toISOString(),
    new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
  );
  for (const appointment of upcoming) {
    const remaining = new Date(appointment.starts_at).getTime() - now.getTime();
    const due = REMINDER_SETTINGS.find(
      (reminder) => settings[reminder.setting] && remaining > 0 && remaining <= reminder.minutes * 60 * 1000
    );
    if (!due) continue;

    const claimed = await repo.claimReminder(appointment.id, due.key);
    if (!claimed) continue;
    return {
      appointmentId: appointment.id,
      patientId: appointment.patient_id,
      patientName: appointment.patients?.full_name ?? "Hasta",
      phone: appointment.patients?.phone ?? "",
      startsAt: appointment.starts_at,
      kindName: appointment.appointment_kinds?.name ?? "Randevu",
      offset: due.key,
      label: due.label,
    };
  }
  return null;
}

export async function recordReminderSent(appointmentId, offset) {
  const id = positiveId(appointmentId, "Randevu");
  if (!REMINDER_SETTINGS.some((reminder) => reminder.key === offset)) {
    throw new ValidationError("Hatırlatma zamanını kontrol edin.");
  }
  await repo.recordReminderSent(id, offset);
}

export async function recordAppointmentContact(id) {
  const appointmentId = positiveId(id, "Randevu");
  const patientId = await repo.getAppointmentPatientId(appointmentId);
  if (!patientId) throw new ValidationError("Randevu kaydı bulunamadı.");
  await repo.insertAppointmentContact(appointmentId, patientId);
}
