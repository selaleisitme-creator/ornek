// Pure rules for the home page (Anasayfa): placing the database's month rows on the charts, chart scales,
// payment shares and the date windows behind the suggestions. The totals themselves are added up in the
// database (011_home_summaries.sql). No database or clock access here: callers pass "today" in, so
// every rule can be tested with fixed dates.

const MONTH_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const DAY_MS = 86_400_000;

// "2026-11-21" → Date at UTC midnight, so day arithmetic never trips over time zones.
function toUtcDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

// "2026-11-21" plus n days (n may be negative) → "2026-11-xx".
export function addDays(isoDate, days) {
  return toIsoDate(new Date(toUtcDate(isoDate).getTime() + days * DAY_MS));
}

// Whole days from one ISO date to another (later minus earlier).
export function daysBetween(fromIso, toIso) {
  return Math.round((toUtcDate(toIso).getTime() - toUtcDate(fromIso).getTime()) / DAY_MS);
}

// "2026-11-21" or a full timestamp → "2026-11".
export function monthKey(value) {
  return String(value).slice(0, 7);
}

// The last `count` months up to and including today's month, oldest first:
// [{ key: "2026-06", label: "Haz" }, …, { key: "2026-11", label: "Kas" }].
export function lastMonths(todayIso, count = 6) {
  const [year, month] = todayIso.split("-").map(Number);
  const months = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - back, 1));
    months.push({ key: toIsoDate(date).slice(0, 7), label: MONTH_SHORT[date.getUTCMonth()] });
  }
  return months;
}

// First day of the oldest chart month, for the database filter.
export function chartStartDate(months) {
  return `${months[0].key}-01`;
}

// Rounds the largest bar up to a readable axis top with four equal steps (0, 50, 100, 150, 200).
export function chartScale(maxValue) {
  if (!(maxValue > 0)) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  const rawStep = maxValue / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 1.5, 2, 2.5, 3, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rawStep);
  const max = step * 4;
  return { max, ticks: [0, 1, 2, 3, 4].map((index) => Math.round(step * index * 1000) / 1000) };
}

// Axis numbers: 1500 → "1.500", 1.5 → "1,5".
export function formatAxis(value) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(value);
}

// Bar labels: whole liras, "18.500 TL".
export function formatWholeMoney(value) {
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Math.round(value))} TL`;
}

// Month rows from the database ({ month: "2026-10-01", … }) placed on the chart's months; a month with no row
// is zero. pick(row) gives the bar's values; empty() the zeros for a missing month.
export function fillMonths(months, rows, pick, empty) {
  const byKey = new Map(rows.map((row) => [monthKey(row.month), row]));
  return months.map((month) => {
    const row = byKey.get(month.key);
    return { ...month, ...(row ? pick(row) : empty) };
  });
}

// Payment method rows from the database ({ code, name, payments }, largest first) with whole-number
// percentages of the total count. Each patient payment counts once; SGK money is not counted (plan 3.7).
export function paymentShares(rows) {
  const total = rows.reduce((sum, row) => sum + row.payments, 0);
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    count: row.payments,
    percent: total ? Math.round((row.payments / total) * 100) : 0,
  }));
}

// The tracking exemption lives with the sold-items rule, so the home suggestion and Stok > Satılan ürünler agree.
export { TRACKING_EXEMPT_BRANDS, isTrackingExempt } from "@/modules/satis/refundRules";

// SGK invoices are cut in the last 7 or the first 7 days of the month (plan 3.7).
export function isSgkInvoiceWindow(todayIso) {
  const date = toUtcDate(todayIso);
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return day <= 7 || day > lastDay - 7;
}

// What is wrong with backups, or null when the last successful one is recent enough.
//   settings: { backup_enabled }   lastRun: newest backup_runs row or null   lastSuccessAt: ISO or null
export function backupProblem({ enabled, lastRun, lastSuccessAt, now }) {
  if (!enabled) return { title: "Otomatik yedekleme kapalı", detail: "Ayarlar'daki Yedekleme bölümünden açın." };
  if (lastRun?.status === "failed") return { title: "Son yedek alınamadı", detail: "Yedekleme kayıtlarını kontrol edip elle bir yedek alın." };
  if (!lastSuccessAt) return { title: "İlk otomatik yedek başarı kaydı yok", detail: "İlk otomatik yedek gece alınır; hemen almak için Ayarlar'da \"Şimdi yedekle\"ye basın." };
  const ageDays = (new Date(now).getTime() - new Date(lastSuccessAt).getTime()) / DAY_MS;
  // Weekly backups: one day of slack after the expected night before warning.
  if (ageDays > 8) return { title: "Son başarılı yedek 8 günden eski", detail: "Haftalık yedeğin çalıştığını Ayarlar'daki Yedekleme bölümünden kontrol edin." };
  return null;
}

// Follow-up windows after a device sale (plan 3.7). A patient is listed when today falls in the window
// and no appointment that is not cancelled falls in the "covered" range after the sale.
export const FOLLOW_UPS = {
  firstCheck: { from: 6, to: 14, coverFrom: 0, coverTo: 15 },
  fortyFive: { from: 38, to: 52, coverFrom: 20, coverTo: 55 },
};

// "Cihaz bakım iletişimi": a maintenance-due patient is listed only while the device sale is under 5 years old (plan
// 3.7) and no appointment is booked yet. Once a visit is waiting, the message has nothing left to ask for.
//   patient: { adaptation_start, next_appointment }; fiveYearsAgo: "YYYY-MM-DD"
export function needsMaintenanceContact(patient, fiveYearsAgo) {
  if (patient?.next_appointment) return false;
  return !patient?.adaptation_start || patient.adaptation_start >= fiveYearsAgo;
}

export function needsFollowUp(rule, saleDate, todayIso, appointmentDays) {
  const age = daysBetween(saleDate, todayIso);
  if (age < rule.from || age > rule.to) return false;
  return !appointmentDays.some((day) => {
    const offset = daysBetween(saleDate, day);
    return offset >= rule.coverFrom && offset <= rule.coverTo;
  });
}

// Warranty notices: ends within 45 days, or ended within the last 60 days.
export function warrantyState(warrantyEnd, todayIso) {
  if (!warrantyEnd) return null;
  const left = daysBetween(todayIso, warrantyEnd);
  if (left >= 0 && left <= 45) return { kind: "ending", days: left };
  if (left < 0 && left >= -60) return { kind: "ended", days: -left };
  return null;
}

// "21 Kasım 2026 Cumartesi · 12:50:48" in Istanbul time, for the live clock on the welcome card.
export function formatWelcomeClock(date) {
  const day = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric", weekday: "long" }).formatToParts(date);
  const pick = (type) => day.find((part) => part.type === type)?.value ?? "";
  const time = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date);
  return `${pick("day")} ${pick("month")} ${pick("year")} ${pick("weekday")} · ${time}`;
}

// Known referral sources get the design's brand mark; anything else a neutral arrow.
const SOURCE_ICONS = [
  [/instagram/i, "instagram", "◎"],
  [/facebook/i, "facebook", "f"],
  [/youtube/i, "youtube", "▶"],
  [/linkedin/i, "linkedin", "in"],
  [/google/i, "google", "G"],
  [/web|site/i, "website", "↗"],
  [/telefon|phone/i, "phone", "☎"],
  [/uygulama|app/i, "app", "▣"],
  [/whatsapp/i, "whatsapp", "✆"],
  [/tavsiye|öneri/i, "other", "★"],
];

export function referralIcon(name) {
  const match = SOURCE_ICONS.find(([pattern]) => pattern.test(name ?? ""));
  return match ? { tone: match[1], mark: match[2] } : { tone: "generic", mark: "↗" };
}
