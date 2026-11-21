import "server-only";
import ExcelJS from "exceljs";
import * as repo from "./backupRepository";
import { updateSettings } from "./settingsRepository";
import { ValidationError } from "./settingsService";
import { BACKUP_TABLES, WEEKDAYS, backupBasePath, isBackupDue, isOffsiteDue, keepCountError, runsToPrune } from "../backupRules";

// Backups (Faz 6b): every table is read with the secret key and written twice, as a complete JSON copy (for
// a restore) and as an Excel workbook (one sheet per table, for reading). Both go to the private "backups"
// bucket; backup_runs records the result and only the newest N backups keep their files.
// Photos stay in their own bucket (only their paths are in the backup); national IDs stay encrypted and
// need NATIONAL_ID_KEY to be read; sign-in accounts and passwords are Supabase's and are not included.

const FORMAT = "selale-admin-backup";
const FORMAT_VERSION = 1;
const EXCEL_CELL_LIMIT = 32_000; // Excel refuses cells over 32,767 characters

export async function runBackup(kind, now = new Date()) {
  const run = await repo.startRun(kind);
  try {
    const tables = {};
    for (const table of BACKUP_TABLES) tables[table] = await repo.readTable(table);

    const createdAt = now.toISOString();
    const json = Buffer.from(
      JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, created_at: createdAt, tables }),
      "utf8"
    );
    const excel = Buffer.from(await buildWorkbook(tables, createdAt));

    const base = backupBasePath(now);
    await repo.uploadFile(`${base}.json`, json, "application/json");
    await repo.uploadFile(`${base}.xlsx`, excel, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await repo.finishRun(run.id, { status: "succeeded", file_path: `${base}.json`, size_bytes: json.length + excel.length });

    await pruneOldBackups();
    return { id: run.id, rows: Object.values(tables).reduce((sum, rows) => sum + rows.length, 0) };
  } catch (error) {
    await repo.finishRun(run.id, { status: "failed" }).catch(() => {});
    throw error;
  }
}

// Called every night by Vercel Cron; backs up only when it is due (the chosen weekday, or a missed week).
export async function runScheduledBackup(now = new Date()) {
  const [settings, last] = await Promise.all([repo.getBackupSettings(), repo.lastSuccessfulRun()]);
  const due = isBackupDue({
    enabled: settings.backup_enabled,
    weekday: settings.backup_weekday,
    lastSuccessAt: last?.finished_at ?? last?.started_at ?? null,
    now,
  });
  if (!due) return { skipped: true };
  return runBackup("scheduled", now);
}

async function pruneOldBackups() {
  const [settings, runs] = await Promise.all([repo.getBackupSettings(), repo.listRuns()]);
  for (const run of runsToPrune(runs, settings.backup_keep_count)) {
    await repo.removeFiles([run.file_path, run.file_path.replace(/\.json$/, ".xlsx")]);
    await repo.clearRunFile(run.id);
  }
}

async function buildWorkbook(tables, createdAt) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(createdAt);

  const info = workbook.addWorksheet("Bilgi");
  info.columns = [{ width: 28 }, { width: 80 }];
  info.addRow(["Şelale İşitme yönetim paneli yedeği"]).font = { bold: true, size: 14 };
  info.addRow(["Oluşturulma", new Date(createdAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })]);
  info.addRow(["Not", "TC numaraları şifrelidir. Fotoğraflar yedekte değildir, yalnızca dosya yolları vardır."]);
  info.addRow([]);
  info.addRow(["Tablo", "Kayıt sayısı"]).font = { bold: true };
  for (const [name, rows] of Object.entries(tables)) info.addRow([name, rows.length]);

  for (const [name, rows] of Object.entries(tables)) {
    const sheet = workbook.addWorksheet(name.slice(0, 31));
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    sheet.columns = columns.map((key) => ({ header: key, key, width: Math.min(40, Math.max(10, key.length + 2)) }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    for (const row of rows) {
      sheet.addRow(Object.fromEntries(columns.map((key) => [key, toCell(row[key])])));
    }
  }
  return workbook.xlsx.writeBuffer();
}

function toCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") value = JSON.stringify(value);
  if (typeof value === "string" && value.length > EXCEL_CELL_LIMIT) return `${value.slice(0, EXCEL_CELL_LIMIT)}…`;
  return value;
}

// ---- Settings card -------------------------------------------------------------------------------------------

export async function getBackupView({ now = new Date() } = {}) {
  const [settings, runs, lastDownload] = await Promise.all([
    repo.getBackupSettings(),
    repo.listRuns(10),
    repo.lastDownloadAt(),
  ]);
  const hasBackup = runs.some((run) => run.status === "succeeded" && run.file_path);
  return {
    enabled: settings.backup_enabled,
    weekday: settings.backup_weekday,
    keepCount: settings.backup_keep_count,
    runs: runs.map((run) => ({
      id: run.id,
      kind: run.kind,
      status: run.status,
      startedAt: run.started_at,
      sizeBytes: run.size_bytes,
      hasFile: Boolean(run.file_path),
    })),
    lastDownloadAt: lastDownload,
    offsiteDue: isOffsiteDue({ hasBackup, lastDownloadAt: lastDownload, now }),
  };
}

export async function saveBackupSettings(input) {
  const weekday = Number(input?.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new ValidationError("Yedek gününü seçin.");
  const keepProblem = keepCountError(input?.keepCount);
  if (keepProblem) throw new ValidationError(keepProblem);
  await updateSettings({
    backup_enabled: Boolean(input?.enabled),
    backup_weekday: weekday,
    backup_keep_count: Number(input.keepCount),
  });
}

// A short-lived link to one of the two files; the download date feeds the monthly reminder.
export async function getDownloadLink(runId, format) {
  if (format !== "json" && format !== "xlsx") throw new ValidationError("Geçersiz dosya türü.");
  const run = await repo.getRun(Number(runId));
  if (!run?.file_path || run.status !== "succeeded") throw new ValidationError("Bu yedeğin dosyası artık yok.");
  const path = format === "json" ? run.file_path : run.file_path.replace(/\.json$/, ".xlsx");
  const url = await repo.signedDownloadUrl(path, path.split("/").pop());
  await repo.markDownloaded(new Date().toISOString());
  return url;
}

export function weekdayLabel(weekday) {
  return WEEKDAYS[weekday] ?? "—";
}
