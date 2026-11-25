import "server-only";
import { summarizeDevices } from "@/lib/devices";
import { todayInClinic } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { decryptNationalId, encryptNationalId, maskNationalId } from "@/lib/nationalId";
import { AccessDeniedError } from "@/lib/auth";
import * as repo from "./patientsRepository";
import { ValidationError } from "./errors";
import {
  PATIENT_TABS,
  adaptationInfo,
  noteInputError,
  patientInputError,
  phoneSearchDigits,
  searchTerm,
  statusLabel,
} from "../patientRules";
import { currentDevices } from "../deviceRules";

// Hastalar rules. Status, devices, warranty and adaptation all come from patient_overview (008), which
// works them out from sales, appointments and contacts, so the list and the home page always agree.
// Devices are never typed in by hand: they reach the card through a sale (or a legacy sale).

// The clinic has a few thousand patients at most; past this the list asks for a narrower search.
export const LIST_LIMIT = 300;

// Callers must `await io()` first: "today" reads the clock.
export async function getPatientList(query) {
  const term = searchTerm(query.ara);
  const search = term ? { term, digits: phoneSearchDigits(query.ara) } : null;
  const today = todayInClinic();

  const [list, referralSources, ...counts] = await Promise.all([
    repo.listPatients({ tab: query.sekme, search, limit: LIST_LIMIT }),
    repo.listReferralSources(),
    ...PATIENT_TABS.map((tab) => repo.countPatients(tab.value)),
  ]);

  return {
    rows: list.rows.map((row) => toListRow(row, today)),
    total: list.total,
    limited: list.total > list.rows.length,
    counts: Object.fromEntries(PATIENT_TABS.map((tab, index) => [tab.value, counts[index]])),
    // For the "Yeni hasta" window's "Bizi nereden duydu?" list.
    referralSources,
  };
}

function toListRow(row, today) {
  return {
    id: row.patient_id,
    patientNo: row.patient_no,
    name: row.full_name,
    phone: formatPhone(row.phone),
    candidate: row.record_type === "candidate",
    devices: summarizeDevices(row.devices),
    status: row.status,
    statusText: statusLabel(row.status),
    adaptation: row.status === "adaptation" ? adaptationInfo(row.adaptation_start, today) : null,
    lastAppointment: row.last_appointment,
    nextAppointment: row.next_appointment,
  };
}

// ---------------------------------------------------------------------------
// Patient card
// ---------------------------------------------------------------------------

// Everything the card shows, or null when the patient does not exist (or was removed).
export async function getPatientCard(id, staff) {
  const patientId = toId(id);
  if (!patientId) return null;
  const patient = await repo.getPatient(patientId);
  if (!patient) return null;

  const today = todayInClinic();
  const [overview, notes, sales, referralSources, hasId, last4] = await Promise.all([
    repo.getOverview(patientId),
    repo.listNotes(patientId),
    repo.listSales(patientId),
    repo.listReferralSources(),
    repo.hasNationalId(patientId),
    staff?.canViewNationalId ? repo.nationalIdLast4(patientId) : Promise.resolve(null),
  ]);

  const items = sales.flatMap((sale) => sale.sale_items ?? []);
  const deviceItemIds = items.filter((item) => item.stock_units?.products?.category === "device").map((item) => item.id);
  const [values, replacements] = await Promise.all([
    repo.listItemValues(sales.map((sale) => sale.id)),
    repo.listReplacements(deviceItemIds),
  ]);
  const valueOf = new Map(values.map((row) => [row.sale_item_id, Number(row.net_value)]));

  return {
    id: patient.id,
    patientNo: patient.patient_no,
    name: patient.full_name,
    phone: patient.phone,
    phoneText: formatPhone(patient.phone),
    birthDate: patient.birth_date,
    address: patient.address,
    candidate: patient.record_type === "candidate",
    registeredOn: patient.registered_on,
    whatsappConsent: Boolean(patient.whatsapp_consent_at),
    referralSourceId: patient.referral_source_id,
    referralSourceName: patient.referral_sources?.name ?? null,
    adaptationStartManual: patient.adaptation_start_manual,
    nationalId: {
      onFile: hasId,
      masked: last4 ? maskNationalId(last4) : null,
      canView: Boolean(staff?.canViewNationalId),
    },
    status: overview?.status ?? "new",
    statusText: statusLabel(overview?.status ?? "new"),
    devices: {
      hasDevice: Boolean(overview?.has_device),
      names: summarizeDevices(overview?.devices),
      right: overview?.right_device ?? null,
      left: overview?.left_device ?? null,
      warrantyEnd: overview?.warranty_end ?? null,
      adaptation: adaptationInfo(overview?.adaptation_start, today),
    },
    lastAppointment: overview?.last_appointment ?? null,
    nextAppointment: overview?.next_appointment ?? null,
    lastContact: overview?.last_contact ?? null,
    notes: notes.map((note) => ({ id: note.id, title: note.title, body: note.body, notedOn: note.noted_on })),
    sales: sales.map((sale) => toSaleView(sale, valueOf)),
    deviceHistory: deviceHistory(sales, replacements),
    currentDevices: currentDevices(sales, replacements),
    referralSources,
  };
}

function productName(unit) {
  const product = unit?.products;
  if (!product) return null;
  return [product.brands?.name, product.name].filter(Boolean).join(" ");
}

// refunds.sale_item_id is unique, so PostgREST embeds a refund as one object (or null), not a list.
function refundsOf(item) {
  return [].concat(item.refunds ?? []);
}

const CATEGORY_LABELS = { device: "İşitme cihazı", receiver: "Receiver", charger: "Şarj cihazı", battery: "Pil", dome: "Dome" };

function toSaleView(sale, valueOf) {
  const items = (sale.sale_items ?? [])
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((item) => {
      const unit = item.stock_units;
      const service = item.service_id !== null && item.service_id !== undefined;
      return {
        id: item.id,
        name: service ? (item.services?.name ?? "Hizmet") : (productName(unit) ?? "Ürün"),
        kind: service ? "Hizmet" : (CATEGORY_LABELS[unit?.products?.category] ?? "Ürün"),
        isDevice: unit?.products?.category === "device",
        serial: unit?.serial_no ?? null,
        earSide: item.ear_side ?? unit?.ear_side ?? null,
        quantity: item.quantity,
        value: valueOf.get(item.id) ?? null,
        refunded: refundsOf(item).length > 0,
      };
    });

  const payments = (sale.sale_payments ?? []).map((payment) => ({
    method: payment.payer === "sgk" ? "SGK" : (payment.payment_methods?.name ?? "Ödeme"),
    amount: Number(payment.amount),
  }));

  return {
    id: sale.id,
    saleNo: sale.sale_no,
    date: sale.sale_date,
    legacy: sale.sale_kind === "legacy",
    items,
    total: items.reduce((sum, item) => sum + (item.value ?? 0), 0),
    payments,
  };
}

const REPLACEMENT_REASONS = { warranty: "Garanti değişimi", service: "Servis değişimi" };

// One row per device sold and per replacement, newest first. "Kullanımda" is the unit the patient has now:
// the sold one, or the newest replacement in its chain; a device returned with a refund is "İade edildi".
function deviceHistory(sales, replacements) {
  const rows = [];
  for (const sale of sales) {
    for (const item of sale.sale_items ?? []) {
      const unit = item.stock_units;
      if (unit?.products?.category !== "device") continue;
      const returned = refundsOf(item).some((refund) => refund.returns_device);
      const chain = replacements.filter((replacement) => replacement.sale_item_id === item.id);
      const name = productName(unit);

      rows.push({
        key: `sale-${item.id}`,
        name,
        serial: unit.serial_no,
        date: sale.sale_date,
        reason: sale.sale_kind === "legacy" ? "Panel öncesi satış" : "Cihaz satışı",
        earSide: item.ear_side ?? unit.ear_side ?? null,
        warrantyEnd: item.warranty_end,
        state: returned ? "returned" : chain.length ? "replaced" : "active",
      });
      chain.forEach((replacement, index) => {
        const last = index === chain.length - 1;
        rows.push({
          key: `replacement-${replacement.id}`,
          name: productName(replacement.new_unit) ?? name,
          serial: replacement.new_unit?.serial_no ?? null,
          previousSerial: replacement.old_unit?.serial_no ?? null,
          date: replacement.replaced_on,
          reason: REPLACEMENT_REASONS[replacement.reason] ?? "Cihaz değişimi",
          earSide: item.ear_side ?? null,
          warrantyEnd: item.warranty_end,
          state: returned ? "returned" : last ? "active" : "replaced",
        });
      });
    }
  }
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.key.localeCompare(a.key));
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

function toId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function findPatient(id) {
  const patientId = toId(id);
  if (!patientId) throw new ValidationError("Geçersiz hasta kaydı.");
  const patient = await repo.getPatient(patientId);
  if (!patient) throw new ValidationError("Hasta kaydı bulunamadı; sayfayı yenileyin.");
  return patient;
}

// encryptNationalId throws a plain Error when NATIONAL_ID_KEY is missing; say what is wrong instead of the
// generic "İşlem tamamlanamadı".
function encryptOrExplain(id) {
  try {
    return encryptNationalId(id);
  } catch (error) {
    console.error(error);
    throw new ValidationError("TC numarası şu an kaydedilemiyor (sunucu ayarı eksik). TC alanını boş bırakıp kaydedebilirsiniz.");
  }
}

function cleanText(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text || null;
}

// The window's fields → patients columns, after the same check the window runs.
function cleanPatientInput(input) {
  const today = todayInClinic();
  const problem = patientInputError(input ?? {}, today);
  if (problem) throw new ValidationError(problem);
  return {
    fields: {
      full_name: cleanText(input.fullName),
      phone: String(input.phone),
      birth_date: cleanText(input.birthDate),
      address: cleanText(input.address),
      referral_source_id: toId(input.referralSourceId),
    },
    nationalId: String(input.nationalId ?? "").replace(/\s/g, "") || null,
    consent: Boolean(input.whatsappConsent),
  };
}

export async function createPatient(input) {
  const { fields, nationalId, consent } = cleanPatientInput(input);
  // Encrypted before the insert, so a missing key stops the save instead of leaving half a record.
  const encrypted = nationalId ? encryptOrExplain(nationalId) : null;
  const row = await repo.insertPatient({
    ...fields,
    record_type: "patient",
    whatsapp_consent_at: consent ? new Date().toISOString() : null,
  });
  if (encrypted) await repo.saveNationalId(row.id, encrypted.encrypted, encrypted.last4);
  return { id: row.id };
}

export async function updatePatient(id, input, staff) {
  const patient = await findPatient(id);
  const { fields, nationalId, consent } = cleanPatientInput(input);

  let encrypted = null;
  if (nationalId) {
    // Anyone may add a missing ID; changing one on file needs the ID permission (the database checks too).
    if (!staff.canViewNationalId && (await repo.hasNationalId(patient.id))) {
      throw new ValidationError("Kayıtlı TC numarasını yalnızca TC izni olan kullanıcı değiştirebilir.");
    }
    encrypted = encryptOrExplain(nationalId);
  }

  await repo.updatePatient(patient.id, {
    ...fields,
    // The date consent was first given is kept; unticking the box withdraws it.
    whatsapp_consent_at: consent ? (patient.whatsapp_consent_at ?? new Date().toISOString()) : null,
  });
  if (encrypted) await repo.saveNationalId(patient.id, encrypted.encrypted, encrypted.last4);
}

export async function addNote(id, input) {
  const patient = await findPatient(id);
  const problem = noteInputError(input ?? {});
  if (problem) throw new ValidationError(problem);
  await repo.insertNote({
    patient_id: patient.id,
    title: String(input.title).trim(),
    body: String(input.body).trim(),
  });
}

// An appointment candidate becomes a patient. No sale or device is added (the design's message says so).
export async function promoteCandidate(id) {
  const patient = await findPatient(id);
  if (patient.record_type !== "candidate") throw new ValidationError("Bu kişi zaten hasta kayıtlarında.");
  await repo.updatePatient(patient.id, { record_type: "patient", registered_on: todayInClinic() });
}

// Hidden, never deleted: sales, appointments and the cash ledger keep pointing at the record.
export async function removePatient(id) {
  const patient = await findPatient(id);
  await repo.updatePatient(patient.id, { active: false });
}

// A WhatsApp draft was opened. Logged in patient_contacts, so the card and the home page know the last
// contact. confirmConsent: the person confirmed in the window that the patient agreed to WhatsApp messages.
export async function logWhatsAppContact(id, { confirmConsent } = {}) {
  const patient = await findPatient(id);
  if (!patient.whatsapp_consent_at) {
    if (!confirmConsent) throw new ValidationError("Önce hastanın WhatsApp iznini onaylayın.");
    await repo.updatePatient(patient.id, { whatsapp_consent_at: new Date().toISOString() });
  }
  await repo.insertContact({ patient_id: patient.id, channel: "whatsapp", purpose: "general" });
}

// The full TC number, for users with the ID permission. Every reveal is logged (national_id_views).
export async function revealNationalId(id, staff) {
  if (!staff.canViewNationalId) throw new AccessDeniedError("No national ID permission");
  const patient = await findPatient(id);
  const encrypted = await repo.revealNationalId(patient.id);
  if (!encrypted) throw new ValidationError("Bu hastanın kayıtlı TC numarası yok.");
  return decryptNationalId(encrypted);
}
