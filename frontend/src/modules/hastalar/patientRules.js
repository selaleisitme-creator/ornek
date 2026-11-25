// Pure rules for the Hastalar page: the address-bar options, how a patient's status is shown, the 45-day
// adaptation countdown, and checking what people type into the patient window. Shared by the screens
// (instant feedback) and the server (the real check), and covered by tests/patientRules.test.js.

import { COUNTRY_CODES } from "@/lib/phone";

// ---------------------------------------------------------------------------
// Address bar (?sekme, ?ara, ?gorunum, ?ac)
// ---------------------------------------------------------------------------

// The design's four filter buttons. "aday" shows appointment candidates; the others show patients.
export const PATIENT_TABS = [
  { value: "tum", label: "Tüm hastalar" },
  { value: "aktif", label: "Aktif kullanıcılar" },
  { value: "adaptasyon", label: "Adaptasyon sürecinde" },
  { value: "aday", label: "Randevu adayları" },
];

const DEFAULTS = { sekme: "tum", ara: null, gorunum: "tablo", ac: null };
const PARAM_ORDER = ["sekme", "ara", "gorunum", "ac"];

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveId(value) {
  const id = Number(first(value));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Search params of /hastalar → a clean query. Unknown values fall back to the defaults.
export function readPatientQuery(params = {}) {
  const sekme = first(params.sekme);
  const ara = String(first(params.ara) ?? "").trim().slice(0, 100);
  return {
    sekme: PATIENT_TABS.some((tab) => tab.value === sekme) ? sekme : DEFAULTS.sekme,
    ara: ara || null,
    gorunum: first(params.gorunum) === "kart" ? "kart" : "tablo",
    // The home page opens a patient card with /hastalar?ac=<id>.
    ac: positiveId(params.ac),
  };
}

// The Hastalar address with some options changed (null removes one). Defaults are left out, so "/hastalar"
// and "/hastalar?sekme=tum" are never two addresses for the same view.
export function patientsHref(query, changes = {}) {
  const merged = { ...DEFAULTS, ...query, ...changes };
  const params = new URLSearchParams();
  for (const key of PARAM_ORDER) {
    const value = merged[key];
    if (value === null || value === undefined || value === "" || value === DEFAULTS[key]) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `/hastalar?${text}` : "/hastalar";
}

// What the search box may send to the database. PostgREST's or=() syntax gives commas, brackets, quotes and
// the * wildcard a meaning, so they are turned into spaces instead of being passed through.
export function searchTerm(text) {
  return String(text ?? "")
    .replace(/[,()*"\\%_:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Phones are stored as "+905321234567". "0532 123 45 67" is searched as "5321234567": digits only, without
// the national trunk zero. Fewer than three digits is not worth a phone search.
export function phoneSearchDigits(text) {
  const digits = String(text ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 3 ? digits : null;
}

// ---------------------------------------------------------------------------
// Status and adaptation
// ---------------------------------------------------------------------------

export const ADAPTATION_DAYS = 45;

// patient_overview.status (008_design_gaps.sql) → the design's labels. tone is a StatusBadge tone.
const STATUS = {
  candidate: { label: "Randevu adayı", tone: "warn" },
  new: { label: "Hasta işlemi bekleniyor", tone: "warn", note: "Satış kaydıyla 45 günlük adaptasyon takibi başlar." },
  adaptation: { label: "Adaptasyon sürecinde", tone: "info" },
  maintenance_due: { label: "Bakım zamanı", tone: "warn" },
  warranty_expired: { label: "Garanti bitti", tone: "danger" },
  active: { label: "Aktif kullanıcı", tone: "ok" },
};

export function statusLabel(status) {
  return STATUS[status] ?? { label: "Yeni kayıt", tone: "neutral" };
}

function dayNumber(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate ?? ""));
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

// The 45-day adaptation after a device sale (or the start date typed on the card). Dates are "2026-11-21".
// Returns null when there is no start date.
//   { state: "waiting" | "active" | "done", start, end, daysLeft, progress (0–100) }
export function adaptationInfo(start, today) {
  const startDay = dayNumber(start);
  const todayDay = dayNumber(today);
  if (startDay === null || todayDay === null) return null;

  const endDay = startDay + ADAPTATION_DAYS;
  const end = new Date(endDay * 86400000).toISOString().slice(0, 10);
  const elapsed = todayDay - startDay;
  if (elapsed < 0) return { state: "waiting", start, end, daysLeft: ADAPTATION_DAYS, progress: 0 };
  if (elapsed >= ADAPTATION_DAYS) return { state: "done", start, end, daysLeft: 0, progress: 100 };
  return {
    state: "active",
    start,
    end,
    daysLeft: ADAPTATION_DAYS - elapsed,
    progress: Math.round((elapsed / ADAPTATION_DAYS) * 100),
  };
}

// "Ahmet Yılmaz" → "AY", in Turkish capitals ("ismail" → "İ").
export function initials(name) {
  return String(name ?? "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toLocaleUpperCase("tr-TR") || "?";
}

// ---------------------------------------------------------------------------
// Patient window
// ---------------------------------------------------------------------------

export const NAME_MAX = 120;
export const ADDRESS_MAX = 300;
export const NOTE_TITLE_MAX = 120;
export const NOTE_BODY_MAX = 4000;

// "+905321234567" → { country: "+90", number: "5321234567" }, for filling the phone box when editing.
// The longest matching country code wins, so "+994…" is not read as "+99" plus the rest.
export function splitPhone(phone) {
  const text = String(phone ?? "");
  const match = [...COUNTRY_CODES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((option) => text.startsWith(option.code));
  if (!match) return { country: "+90", number: text.replace(/^\+/, "") };
  return { country: match.code, number: text.slice(match.code.length) };
}

// Official TC kimlik checksum (same rule as lib/nationalId.js, which is server-only).
export function looksLikeNationalId(value) {
  const id = String(value ?? "");
  if (!/^[1-9]\d{10}$/.test(id)) return false;
  const d = id.split("").map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = d.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10;
  return d[9] === tenth && d[10] === eleventh;
}

function isRealDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// The first problem with the patient window's input, in Turkish, or null when it can be saved.
// phone is already normalised by PhoneInput ("+90…", or "" when the number is not valid).
export function patientInputError({ fullName, phone, birthDate, address, nationalId }, today) {
  const name = String(fullName ?? "").trim();
  if (!name) return "Ad soyad yazın.";
  if (name.length > NAME_MAX) return `Ad soyad en fazla ${NAME_MAX} karakter olabilir.`;

  if (!String(phone ?? "").trim()) return "Ülke koduyla birlikte geçerli bir telefon numarası girin.";
  if (!/^\+[0-9]{7,15}$/.test(String(phone))) return "Ülke koduyla birlikte geçerli bir telefon numarası girin.";

  const birth = String(birthDate ?? "").trim();
  if (birth) {
    if (!isRealDate(birth)) return "Doğum tarihini kontrol edin.";
    if (today && birth > today) return "Doğum tarihi bugünden sonra olamaz.";
    if (birth < "1900-01-01") return "Doğum tarihini kontrol edin.";
  }

  if (String(address ?? "").trim().length > ADDRESS_MAX) return `Adres en fazla ${ADDRESS_MAX} karakter olabilir.`;

  const id = String(nationalId ?? "").replace(/\s/g, "");
  if (id && !looksLikeNationalId(id)) return "TC kimlik numarası geçerli değil. 11 haneyi kontrol edin.";
  return null;
}

export function noteInputError({ title, body }) {
  const cleanTitle = String(title ?? "").trim();
  const cleanBody = String(body ?? "").trim();
  if (!cleanTitle) return "Not başlığını yazın.";
  if (cleanTitle.length > NOTE_TITLE_MAX) return `Başlık en fazla ${NOTE_TITLE_MAX} karakter olabilir.`;
  if (!cleanBody) return "Notu yazın.";
  if (cleanBody.length > NOTE_BODY_MAX) return `Not en fazla ${NOTE_BODY_MAX} karakter olabilir.`;
  return null;
}

// The WhatsApp draft the card opens. A person reads it and presses send.
export function whatsappGreeting(name) {
  const cleanName = String(name ?? "").trim();
  return `Merhaba${cleanName ? ` ${cleanName}` : ""}, Şelale İşitme'den sizinle iletişime geçiyoruz.`;
}

// Ear side of a sold device, as the card shows it.
export function earSideLabel(side) {
  return { right: "Sağ kulak", left: "Sol kulak", both: "İki kulak" }[side] ?? null;
}
