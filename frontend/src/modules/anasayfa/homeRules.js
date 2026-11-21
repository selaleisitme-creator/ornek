// Pure rules for the home page (Anasayfa): month buckets for the charts, chart scales, payment shares and
// the date windows behind the suggestions. No database or clock access here: callers pass "today" in, so
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

// Monthly sales for the chart: sale value by sale date minus refunds by refund date (plan 3.7), and the
// number of sales per month for people without the accounting permission. Rows outside the months are ignored.
//   items:   [{ sale_id, sale_date, net_value }]
//   refunds: [{ refunded_on, amount }]
export function bucketSales(months, items, refunds) {
  const byKey = new Map(months.map((month) => [month.key, { ...month, amount: 0, sales: new Set() }]));
  for (const item of items) {
    const bucket = byKey.get(monthKey(item.sale_date));
    if (!bucket) continue;
    bucket.amount += Number(item.net_value) || 0;
    bucket.sales.add(item.sale_id);
  }
  for (const refund of refunds) {
    const bucket = byKey.get(monthKey(refund.refunded_on));
    if (bucket) bucket.amount -= Number(refund.amount) || 0;
  }
  return [...byKey.values()].map(({ sales, amount, ...month }) => ({
    ...month,
    amount: Math.round(amount * 100) / 100,
    count: sales.size,
  }));
}

// A patient's first attended visit counts as "new" only if they were registered shortly before it.
// Patients typed in from before the panel carry an old registration date (or a past device), so their
// first visit in the panel counts as a returning visit (plan 3.7).
export const NEW_PATIENT_WINDOW_DAYS = 60;

// Attended visits per month, split into new and returning patients.
//   visits:     [{ patient_id, starts_at }] attended visits inside the chart months
//   firstVisit: Map patient_id → ISO timestamp of the patient's first attended visit ever
//   patients:   Map patient_id → { registered_on, has_past_device }
export function bucketVisits(months, visits, firstVisit, patients) {
  const byKey = new Map(months.map((month) => [month.key, { ...month, fresh: 0, returning: 0 }]));
  for (const visit of visits) {
    const bucket = byKey.get(monthKey(visit.starts_at));
    if (!bucket) continue;
    if (isNewPatientVisit(visit, firstVisit.get(visit.patient_id), patients.get(visit.patient_id))) bucket.fresh += 1;
    else bucket.returning += 1;
  }
  return [...byKey.values()];
}

export function isNewPatientVisit(visit, firstVisitAt, patient) {
  if (!firstVisitAt || firstVisitAt !== visit.starts_at) return false;
  if (!patient || patient.has_past_device) return false;
  const visitDay = String(visit.starts_at).slice(0, 10);
  return daysBetween(patient.registered_on, visitDay) <= NEW_PATIENT_WINDOW_DAYS;
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

// Payment methods by number of patient payments (each part of a split payment counts once; SGK money is
// not a method the patient chose). Largest first; percentages are whole numbers of the total count.
//   payments: [{ payment_method }]   methods: [{ code, name }]
export function paymentShares(payments, methods) {
  const names = new Map(methods.map((method) => [method.code, method.name]));
  const counts = new Map();
  for (const payment of payments) counts.set(payment.payment_method, (counts.get(payment.payment_method) ?? 0) + 1);
  const total = payments.length;
  return [...counts.entries()]
    .map(([code, count]) => ({ code, name: names.get(code) ?? code, count, percent: total ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "tr"));
}

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
  if (!lastSuccessAt) return { title: "İlk otomatik yedek başarı kaydı yok", detail: "Yedekleme ayarlarını kontrol edin; ilk yedek alınınca bu uyarı kalkar." };
  const ageDays = (new Date(now).getTime() - new Date(lastSuccessAt).getTime()) / DAY_MS;
  if (ageDays > 7) return { title: "Son başarılı yedek 7 günden eski", detail: "Haftalık yedeğin çalıştığını kontrol edin." };
  return null;
}

// Follow-up windows after a device sale (plan 3.7). A patient is listed when today falls in the window
// and no appointment that is not cancelled falls in the "covered" range after the sale.
export const FOLLOW_UPS = {
  firstCheck: { from: 6, to: 14, coverFrom: 0, coverTo: 15 },
  fortyFive: { from: 38, to: 52, coverFrom: 20, coverTo: 55 },
};

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

// "Randevu kaynakları": where new patients came from. Each patient counts once, by their first appointment
// that was not cancelled; its status says whether that first visit happened. The source is the one on that
// appointment, or the patient's own source when the appointment has none (plan 3.7, decided 2026-11-21:
// the table answers "where did my patients come from", so repeat visits must not inflate a channel).
//   appointments:   [{ id, patient_id, starts_at, status, referral_source_id }] (cancelled ones left out)
//   patientSources: Map patient_id → referral_source_id
// Returns Map source_id → { total, attended, noShow, waiting }.
export function countFirstVisitsBySource(appointments, patientSources) {
  const first = new Map();
  for (const appointment of appointments) {
    const known = first.get(appointment.patient_id);
    const earlier =
      !known ||
      appointment.starts_at < known.starts_at ||
      (appointment.starts_at === known.starts_at && appointment.id < known.id);
    if (earlier) first.set(appointment.patient_id, appointment);
  }
  const counts = new Map();
  for (const appointment of first.values()) {
    const sourceId = appointment.referral_source_id ?? patientSources.get(appointment.patient_id) ?? null;
    if (sourceId === null) continue;
    const row = counts.get(sourceId) ?? { total: 0, attended: 0, noShow: 0, waiting: 0 };
    row.total += 1;
    if (appointment.status === "attended") row.attended += 1;
    else if (appointment.status === "no_show") row.noShow += 1;
    else if (appointment.status === "waiting") row.waiting += 1;
    counts.set(sourceId, row);
  }
  return counts;
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
