// Pure rules for the backups (Faz 6b, decided 2026-11-21): a weekly automatic backup on the chosen weekday,
// the last N kept in the private "backups" bucket, and a monthly reminder to download one and keep it
// outside Supabase. No database or clock access here: callers pass "now" in.

// Every table of the panel, parents before children, so a restore can insert them in this order.
// tests/backupRules.test.js compares this list with the migrations: a new table must be added here (or to
// BACKUP_SKIPPED with a reason), otherwise the test fails and the backup would silently miss it.
export const BACKUP_TABLES = [
  "settings",
  "profiles",
  "payment_methods",
  "links",
  "brands",
  "suppliers",
  "products",
  "product_photos",
  "services",
  "stock_receipts",
  "stock_units",
  "stock_removals",
  "price_changes",
  "referral_sources",
  "patients",
  "patient_national_ids",
  "national_id_views",
  "patient_notes",
  "patient_contacts",
  "sales",
  "invoices",
  "sale_items",
  "sale_payments",
  "refunds",
  "sale_tasks",
  "device_replacements",
  "appointment_requests",
  "appointment_kinds",
  "appointments",
  "appointment_reminders",
  "expense_categories",
  "expense_templates",
  "cash_entries",
];

// Tables left out on purpose.
export const BACKUP_SKIPPED = {
  backup_runs: "the backups' own log; restoring it would describe files that no longer exist",
  mfa_recovery_codes: "hashes of sign-in recovery codes; after a restore everyone gets new ones",
};

export const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"]; // 0 = Sunday, like settings.backup_weekday
export const KEEP_MIN = 1;
export const KEEP_MAX = 52;
const DAY_MS = 86_400_000;

// Istanbul's date parts of a moment.
function clinicParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { ...parts, weekday };
}

// The nightly job runs every day; it takes a backup on the chosen weekday, or on any day once the last
// successful backup is more than 7 days old (a missed week is caught up the next night).
export function isBackupDue({ enabled, weekday, lastSuccessAt, now }) {
  if (!enabled) return false;
  if (clinicParts(new Date(now)).weekday === weekday) return true;
  if (!lastSuccessAt) return true;
  return new Date(now).getTime() - new Date(lastSuccessAt).getTime() > 7 * DAY_MS;
}

// "selale-yedek-2026-11-23-0300", in Istanbul time; the folder is the year, so the bucket stays tidy.
export function backupBasePath(now) {
  const p = clinicParts(new Date(now));
  return `${p.year}/selale-yedek-${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
}

// Successful backups whose files should go: everything after the newest `keep` that still have files.
//   runs: [{ id, status, started_at, file_path }] in any order
export function runsToPrune(runs, keep) {
  return runs
    .filter((run) => run.status === "succeeded" && run.file_path)
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))
    .slice(keep);
}

// Monthly reminder to keep a copy outside Supabase: due when there is a backup to download and none was
// downloaded in the last 30 days.
export function isOffsiteDue({ hasBackup, lastDownloadAt, now }) {
  if (!hasBackup) return false;
  if (!lastDownloadAt) return true;
  return new Date(now).getTime() - new Date(lastDownloadAt).getTime() > 30 * DAY_MS;
}

export function keepCountError(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < KEEP_MIN || number > KEEP_MAX) {
    return `Saklanacak yedek sayısı ${KEEP_MIN} ile ${KEEP_MAX} arasında bir tam sayı olmalı.`;
  }
  return null;
}

// 1536 → "1,5 KB".
export function formatBytes(bytes) {
  if (typeof bytes !== "number" || !(bytes >= 0)) return "—"; // null >= 0 is true in JavaScript
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: unit ? 1 : 0 }).format(value)} ${units[unit]}`;
}
