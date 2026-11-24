import "server-only";
import { todayInClinic, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import * as repo from "./homeRepository";
import { lastDownloadAt } from "@/modules/ayarlar/server/backupRepository";
import { isOffsiteDue } from "@/modules/ayarlar/backupRules";
import { ValidationError } from "./errors";
import {
  FOLLOW_UPS,
  addDays,
  backupProblem,
  chartStartDate,
  daysBetween,
  fillMonths,
  isSgkInvoiceWindow,
  isTrackingExempt,
  lastMonths,
  needsFollowUp,
  paymentShares,
  referralIcon,
  warrantyState,
} from "../homeRules";

// Shapes the home page: three charts, the suggestions and the referral table. The totals are added up in the
// database (011_home_summaries.sql); the page receives only the results. People without the accounting permission never get
// money totals: the sales chart switches to sale counts and the pending SGK suggestion is left out
// (plan 3.7, home question 2).

const LIST_LIMIT = 300;

// Istanbul has stayed on UTC+3 all year since 2016, so the clinic day starts at 00:00+03:00.
function clinicDayStart(todayIso) {
  return `${todayIso}T00:00:00+03:00`;
}

export async function getHomeView({ canSeeMoney, isAdmin = false, now = new Date() }) {
  const today = todayInClinic(now);
  const months = lastMonths(today, 6);

  const [sales, visits, payments, suggestions, referrals] = await Promise.all([
    getSalesChart(months, canSeeMoney),
    getVisitsChart(months),
    getPaymentChart(),
    getSuggestions({ today, now, canSeeMoney, isAdmin }),
    getReferralTable(),
  ]);
  return { months, sales, visits, payments, suggestions, referrals };
}

async function getSalesChart(months, canSeeMoney) {
  const [rows, total] = await Promise.all([repo.salesByMonth(chartStartDate(months)), repo.salesTotal()]);
  if (!canSeeMoney) {
    return {
      mode: "count",
      bars: fillMonths(months, rows, (row) => ({ value: row.sale_count }), { value: 0 }),
      total: total.sale_count,
    };
  }
  return {
    mode: "money",
    bars: fillMonths(months, rows, (row) => ({ value: Number(row.amount) || 0 }), { value: 0 }),
    total: Number(total.amount) || 0,
  };
}

async function getVisitsChart(months) {
  const rows = await repo.visitsByMonth(chartStartDate(months));
  return fillMonths(
    months,
    rows,
    (row) => ({ fresh: row.new_patients, returning: row.returning_patients }),
    { fresh: 0, returning: 0 }
  );
}

async function getPaymentChart() {
  const rows = await repo.paymentMethodCounts();
  const shares = paymentShares(rows);
  return { total: shares.reduce((sum, row) => sum + row.count, 0), rows: shares };
}

// ---- Suggestions ----------------------------------------------------------------------------------------

async function getSuggestions({ today, now, canSeeMoney, isAdmin }) {
  const followWindow = {
    saleFrom: addDays(today, -FOLLOW_UPS.fortyFive.to),
    saleTo: addDays(today, -FOLLOW_UPS.firstCheck.from),
    warrantyFrom: addDays(today, -60),
    warrantyTo: addDays(today, 45),
  };
  const [maintenance, candidates, stock, webRequests, unmarked, trackingRows, backupSettings, lastRun, lastSuccess, links, sgk] =
    await Promise.all([
      repo.listMaintenanceDue(),
      repo.listFollowUpCandidates(followWindow),
      repo.listStockAlerts(),
      repo.countNewWebRequests(),
      repo.countUnmarkedAppointments(clinicDayStart(today), now.toISOString()),
      repo.listUnitsMissingTracking(),
      repo.getBackupSettings(),
      repo.getLastBackupRun(null),
      repo.getLastBackupRun("succeeded"),
      repo.listInvoiceLinks(),
      canSeeMoney ? repo.listPendingSgk() : Promise.resolve([]),
    ]);

  const appointmentDays = await repo.listAppointmentDays(
    candidates.map((patient) => patient.patient_id),
    clinicDayStart(followWindow.saleFrom)
  );
  const daysByPatient = new Map();
  for (const row of appointmentDays) {
    const list = daysByPatient.get(row.patient_id) ?? [];
    list.push(String(row.starts_at).slice(0, 10));
    daysByPatient.set(row.patient_id, list);
  }

  const list = [];

  // Maintenance: the device sale must be under 5 years old (plan 3.7).
  const fiveYearsAgo = addDays(today, -5 * 365);
  const dueMaintenance = maintenance.filter((patient) => !patient.adaptation_start || patient.adaptation_start >= fiveYearsAgo);
  if (dueMaintenance.length) {
    list.push({
      id: "maintenance",
      tone: "blue",
      icon: "phone",
      kind: "Hasta takibi",
      title: `${dueMaintenance.length} hasta için cihaz bakım iletişimi`,
      detail: "Bakım aralığı dolan aktif cihaz kullanıcıları. Mesajı siz gönderirsiniz; kayıtlar kendiliğinden değişmez.",
      rule: "Koşul: Son \"Geldi\" randevusundan, son bakım iletişiminden ya da cihaz satışından bu yana bakım aralığı geçti.",
      patients: dueMaintenance.map((patient) => ({
        ...patientRow(patient),
        note: `Bakım iletişimi zamanı${patient.devices ? ` · ${patient.devices}` : ""}`,
        whatsappText: `Merhaba ${firstName(patient.full_name)}, Şelale İşitme'den yazıyoruz. Cihazınızın periyodik bakım zamanı geldi; size uygun bir gün için randevu oluşturalım mı?`,
      })),
      action: { href: "/hastalar", label: "Hastalar →" },
    });
  }

  if (isSgkInvoiceWindow(today)) {
    list.push({
      id: "sgk-invoice",
      tone: "amber",
      icon: "invoice",
      kind: "SGK",
      title: "SGK fatura kesim zamanı",
      detail: "Ayın son ve ilk haftası: önce Medula'dan provizyonları kontrol edin, sonra Kolaysoft'ta faturayı kesin.",
      rule: "Koşul: Ayın son 7 günü ya da ilk 7 günü.",
      sgkLinks: invoiceLinks(links),
      action: { href: "/baglantilar", label: "Bağlantılar →" },
    });
  }

  if (stock.length) {
    const out = stock.filter((row) => row.stock_level === "out").length;
    list.push({
      id: "stock",
      tone: "amber",
      icon: "box",
      kind: "Stok",
      title: out ? `${stock.length} modelde stok tükendi ya da azaldı` : `${stock.length} model az stok seviyesinde`,
      detail: stock
        .slice(0, 4)
        .map((row) => `${row.brand_name} ${row.name} (${row.in_stock ? `${row.in_stock} kaldı` : "tükendi"})`)
        .join(" · ") + (stock.length > 4 ? ` · +${stock.length - 4} model` : ""),
      rule: "Koşul: Model stoğu 0, ya da alt stok eşiğinde veya altında.",
      action: { href: "/stok", label: "Stokları aç →" },
    });
  }

  const tracking = trackingRows.filter((unit) => !isTrackingExempt(unit.products?.brands?.name));
  if (tracking.length) {
    list.push({
      id: "tracking",
      tone: "amber",
      icon: "tag",
      kind: "Satış kaydı",
      title: `${tracking.length} satılan üründe takip bilgisi eksik`,
      detail: tracking
        .slice(0, 3)
        .map((unit) => {
          const missing = [!unit.production_date && "ÜRT tarihi", !unit.wsa_code && "WSA kodu"].filter(Boolean).join(" ve ");
          return `${unit.products?.brands?.name ?? ""} ${unit.products?.name ?? ""}${unit.serial_no ? ` · ${unit.serial_no}` : ""}: ${missing}`;
        })
        .join(" · ") + (tracking.length > 3 ? ` · +${tracking.length - 3} ürün` : ""),
      rule: "Koşul: Satılan cihaz ya da şarj cihazında üretim tarihi veya WSA kodu boş (Coselgi hariç).",
      action: { href: "/stok", label: "Stoğu aç →" },
    });
  }

  if (webRequests > 0) {
    list.push({
      id: "web-requests",
      tone: "blue",
      icon: "globe",
      kind: "Randevu",
      title: `${webRequests} web randevu talebi bekliyor`,
      detail: "Talep saatini ve uygunluğu Randevular bölümünde kontrol edip durumu güncelleyin.",
      rule: "Koşul: Siteden gelen ve henüz cevaplanmamış talepler.",
      action: { href: "/randevular", label: "Bekleyen talepler →" },
    });
  }

  if (unmarked > 0) {
    list.push({
      id: "attendance",
      tone: "amber",
      icon: "calendar",
      kind: "Randevu",
      title: `${unmarked} bugünkü randevuda katılım durumu girilmemiş`,
      detail: "Saati geçmiş randevularda Geldi / Gelmedi bilgisini kaydedin.",
      rule: "Koşul: Bugünkü randevunun saati geçti ve durumu hâlâ Bekliyor.",
      action: { href: "/randevular", label: "Gün akışını aç →" },
    });
  }

  const followUp = (rule) =>
    candidates.filter(
      (patient) => patient.adaptation_start && needsFollowUp(rule, patient.adaptation_start, today, daysByPatient.get(patient.patient_id) ?? [])
    );
  const firstCheck = followUp(FOLLOW_UPS.firstCheck);
  if (firstCheck.length) {
    list.push({
      id: "first-check",
      tone: "blue",
      icon: "ear",
      kind: "Hasta takibi",
      title: `${firstCheck.length} hastada ilk adaptasyon kontrolü zamanı`,
      detail: "Satıştan 6–14 gün sonra; satıştan sonraki ilk 15 günde randevusu olmayanlar.",
      rule: "Koşul: Cihaz satışından 6–14 gün geçti ve satıştan sonraki ilk 15 günde iptal edilmemiş randevu yok.",
      patients: firstCheck.map((patient) => ({
        ...patientRow(patient),
        note: `${daysBetween(patient.adaptation_start, today)} gündür cihaz kullanıyor${patient.devices ? ` · ${patient.devices}` : ""}`,
        bookAppointment: true,
      })),
      action: { href: "/hastalar", label: "Hasta kartlarını aç →" },
    });
  }
  const fortyFive = followUp(FOLLOW_UPS.fortyFive);
  if (fortyFive.length) {
    list.push({
      id: "forty-five",
      tone: "amber",
      icon: "ear",
      kind: "Hasta takibi",
      title: `${fortyFive.length} hastada 45 günlük adaptasyon takibi zamanı`,
      detail: "Satıştan 38–52 gün sonra; satıştan sonraki 20.–55. günler arasında randevusu olmayanlar.",
      rule: "Koşul: Cihaz satışından 38–52 gün geçti ve 20.–55. günler arasında iptal edilmemiş randevu yok.",
      patients: fortyFive.map((patient) => ({
        ...patientRow(patient),
        note: `${daysBetween(patient.adaptation_start, today)} günlük adaptasyon süreci${patient.devices ? ` · ${patient.devices}` : ""}`,
        bookAppointment: true,
      })),
      action: { href: "/hastalar", label: "Hasta kartlarını aç →" },
    });
  }

  const warranty = candidates
    .map((patient) => ({ patient, state: warrantyState(patient.warranty_end, today) }))
    .filter((entry) => entry.state);
  const ending = warranty.filter((entry) => entry.state.kind === "ending");
  const ended = warranty.filter((entry) => entry.state.kind === "ended");
  if (ending.length) {
    list.push({
      id: "warranty-ending",
      tone: "amber",
      icon: "shield",
      kind: "Garanti",
      title: `${ending.length} hastanın cihaz garantisi bitiyor`,
      detail: "Garantinin bitmesine 45 günden az kaldı; bitmeden bir kontrol randevusu önerin.",
      rule: "Koşul: Garantinin bitmesine 0–45 gün kaldı.",
      patients: ending.map(({ patient, state }) => ({
        ...patientRow(patient),
        note: `Garanti ${formatDate(patient.warranty_end)} tarihinde bitiyor (${state.days} gün)`,
        bookAppointment: true,
      })),
      action: { href: "/hastalar", label: "Hastaları aç →" },
    });
  }
  if (ended.length) {
    list.push({
      id: "warranty-ended",
      tone: "blue",
      icon: "shield",
      kind: "Garanti",
      title: `${ended.length} hastanın cihaz garantisi yeni bitti`,
      detail: "Garanti son 60 gün içinde bitti; ücretli bakım ve yeni cihaz seçeneklerini konuşabilirsiniz.",
      rule: "Koşul: Garanti son 60 gün içinde bitti.",
      patients: ended.map(({ patient, state }) => ({
        ...patientRow(patient),
        note: `Garanti ${state.days} gün önce bitti${patient.devices ? ` · ${patient.devices}` : ""}`,
      })),
      action: { href: "/hastalar", label: "Hastaları aç →" },
    });
  }

  if (canSeeMoney && sgk.length) {
    const amount = sgk.reduce((sum, row) => sum + (Number(row.sgk_remaining) || 0), 0);
    list.push({
      id: "sgk-pending",
      tone: "blue",
      icon: "invoice",
      kind: "Muhasebe",
      title: `${sgk.length} satışta SGK ödemesi bekleniyor`,
      detail: `SGK'dan gelmesi beklenen toplam ${formatMoney(amount)}.`,
      rule: "Koşul: SGK payı satışa yazıldı, ödemesi henüz kaydedilmedi.",
      action: { href: "/muhasebe", label: "Alacakları aç →" },
    });
  }

  const backup = backupProblem({
    enabled: backupSettings?.backup_enabled ?? true,
    lastRun,
    lastSuccessAt: lastSuccess?.finished_at ?? lastSuccess?.started_at ?? null,
    now,
  });
  if (backup) {
    list.push({
      id: "backup",
      tone: "blue",
      icon: "disk",
      kind: "Yedekleme",
      title: backup.title,
      detail: backup.detail,
      rule: "Koşul: Son yedek başarısız, yedekleme kapalı ya da son başarılı yedek 8 günden eski.",
      action: { href: "/ayarlar", label: "Yedeklemeyi kontrol et →" },
    });
  }
  // Monthly copy outside Supabase (decided 2026-11-21); only the admin can download, so only they see it.
  if (isAdmin && lastSuccess && isOffsiteDue({ hasBackup: true, lastDownloadAt: await lastDownloadAt(), now })) {
    list.push({
      id: "backup-offsite",
      tone: "amber",
      icon: "disk",
      kind: "Yedekleme",
      title: "Bu ayın dış yedeğini alın",
      detail: "Son yedeğin Excel ve JSON dosyalarını Ayarlar'dan indirip Google Drive'a ya da bilgisayara kaydedin. Supabase'e bir şey olursa bu kopya kalır.",
      rule: "Koşul: Son 30 günde hiçbir yedek indirilmedi.",
      action: { href: "/ayarlar", label: "Yedekleri aç →" },
    });
  }


  return list;
}

function patientRow(patient) {
  return { id: patient.patient_id, name: patient.full_name, phone: patient.phone };
}

function firstName(fullName) {
  return String(fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

// Medula has no link of its own yet; when there is no link named "Medula", Medikal Merkez opens instead.
function invoiceLinks(links) {
  const medula = links.find((link) => /medula/i.test(link.name)) ?? links.find((link) => link.system_key === "medical_center");
  const kolaysoft = links.find((link) => link.system_key === "kolaysoft");
  return [
    { letter: "M", name: "Medula", hint: "Provizyon ve reçete kontrolü", url: medula?.url ?? null },
    { letter: "K", name: "Kolaysoft", hint: "E-fatura kesimi", url: kolaysoft?.url ?? null },
  ];
}

// ---- Referral sources -----------------------------------------------------------------------------------

async function getReferralTable() {
  const [sources, countRows] = await Promise.all([repo.listReferralSources(), repo.referralCounts()]);
  const counts = new Map(
    countRows.map((row) => [row.source_id, { total: row.total, attended: row.attended, noShow: row.no_show, waiting: row.waiting }])
  );
  const empty = { total: 0, attended: 0, noShow: 0, waiting: 0 };
  const rows = sources.map((source) => ({
    id: source.id,
    name: source.name,
    visible: source.visible,
    icon: referralIcon(source.name),
    ...(counts.get(source.id) ?? empty),
  }));
  const shown = rows.filter((row) => row.visible);
  return { rows, shownTotal: shown.reduce((sum, row) => sum + row.total, 0) };
}

// ---- Drill-down lists -------------------------------------------------------------------------------------

export async function getSoldItems() {
  const rows = await repo.listSoldItems(LIST_LIMIT);
  return rows.map((row) => ({
    id: row.sale_item_id,
    date: row.sale_date,
    title: row.device?.trim() ? row.device : row.operation,
    // Goods (a stock unit) open in Stok > Satılan ürünler, framed in blue; services are not listed there.
    href: row.device?.trim() ? `/stok?sekme=satilan&ac=${row.sale_item_id}#sold-${row.sale_item_id}` : null,
    serialNo: row.serial_no,
    amount: Number(row.net_value) || 0,
    refunded: row.refunded,
  }));
}

export async function getArrivedVisits() {
  const rows = await repo.listArrivedVisits(LIST_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    patientId: row.patient_id,
    name: row.patients?.full_name ?? "—",
    kind: row.appointment_kinds?.name ?? "",
  }));
}

// ---- Referral source management -------------------------------------------------------------------------

export async function setReferralVisibility(changes) {
  if (!Array.isArray(changes) || changes.length > 100) throw new ValidationError("Geçersiz seçim.");
  for (const change of changes) {
    const id = Number(change?.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new ValidationError("Geçersiz kaynak.");
    await repo.updateReferralSource(id, { visible: Boolean(change.visible) });
  }
}

export async function addReferralSource(name) {
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  if (!clean) throw new ValidationError("Kaynak adını yazın.");
  if (clean.length > 40) throw new ValidationError("Kaynak adı en fazla 40 karakter olabilir.");
  const sortOrder = (await repo.maxReferralSortOrder()) + 1;
  return repo.insertReferralSource(clean, sortOrder);
}

// Removing hides the source from the list and the pickers; old appointments keep their source.
export async function removeReferralSource(id) {
  const sourceId = Number(id);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) throw new ValidationError("Geçersiz kaynak.");
  await repo.updateReferralSource(sourceId, { active: false });
}
