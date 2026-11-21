import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKUP_SKIPPED,
  BACKUP_TABLES,
  backupBasePath,
  formatBytes,
  isBackupDue,
  isOffsiteDue,
  keepCountError,
  runsToPrune,
} from "../src/modules/ayarlar/backupRules";

describe("backup table list", () => {
  it("covers every table the migrations create", () => {
    const folder = join(__dirname, "..", "supabase", "migrations");
    const created = new Set();
    for (const file of readdirSync(folder).filter((name) => name.endsWith(".sql"))) {
      const sql = readFileSync(join(folder, file), "utf8");
      for (const match of sql.matchAll(/create table (?:if not exists )?public\.([a-z_0-9]+)/gi)) created.add(match[1]);
    }
    const listed = new Set([...BACKUP_TABLES, ...Object.keys(BACKUP_SKIPPED)]);
    const missing = [...created].filter((name) => !listed.has(name));
    // A failure here names the new table: add it to BACKUP_TABLES (or BACKUP_SKIPPED with a reason).
    expect(missing).toEqual([]);
  });

  it("lists each table once", () => {
    expect(new Set(BACKUP_TABLES).size).toBe(BACKUP_TABLES.length);
  });
});

describe("isBackupDue", () => {
  // 2026-11-22 is a Sunday; 00:10 UTC is 03:10 in Istanbul.
  const sundayNight = "2026-11-22T00:10:00Z";
  const mondayNight = "2026-11-23T00:10:00Z";

  it("runs on the chosen weekday", () => {
    expect(isBackupDue({ enabled: true, weekday: 0, lastSuccessAt: "2026-11-21T00:00:00Z", now: sundayNight })).toBe(true);
  });

  it("waits on other days while the last backup is recent", () => {
    expect(isBackupDue({ enabled: true, weekday: 0, lastSuccessAt: "2026-11-22T00:10:00Z", now: mondayNight })).toBe(false);
  });

  it("catches up a missed week and takes the very first backup at once", () => {
    expect(isBackupDue({ enabled: true, weekday: 3, lastSuccessAt: "2026-11-10T00:00:00Z", now: mondayNight })).toBe(true);
    expect(isBackupDue({ enabled: true, weekday: 3, lastSuccessAt: null, now: mondayNight })).toBe(true);
  });

  it("never runs when switched off", () => {
    expect(isBackupDue({ enabled: false, weekday: 0, lastSuccessAt: null, now: sundayNight })).toBe(false);
  });

  it("uses the Istanbul day, not UTC (Saturday 22:30 UTC is already Sunday in Istanbul)", () => {
    expect(isBackupDue({ enabled: true, weekday: 0, lastSuccessAt: "2026-11-20T00:00:00Z", now: "2026-11-21T22:30:00Z" })).toBe(true);
  });
});

describe("files", () => {
  it("names backups by Istanbul time inside a year folder", () => {
    expect(backupBasePath("2026-11-22T00:10:00Z")).toBe("2026/selale-yedek-2026-11-22-0310");
  });

  it("prunes only successful backups with files beyond the newest ones", () => {
    const runs = [
      { id: 1, status: "succeeded", started_at: "2026-11-01", file_path: "a" },
      { id: 2, status: "failed", started_at: "2026-11-08", file_path: null },
      { id: 3, status: "succeeded", started_at: "2026-11-15", file_path: "c" },
      { id: 4, status: "succeeded", started_at: "2026-11-22", file_path: "d" },
      { id: 5, status: "succeeded", started_at: "2026-10-01", file_path: null },
    ];
    expect(runsToPrune(runs, 2).map((run) => run.id)).toEqual([1]);
    expect(runsToPrune(runs, 8)).toEqual([]);
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(null)).toBe("—");
  });
});

describe("monthly copy outside Supabase", () => {
  const now = "2026-11-22T10:00:00Z";
  it("asks for a download when none was made in 30 days", () => {
    expect(isOffsiteDue({ hasBackup: true, lastDownloadAt: null, now })).toBe(true);
    expect(isOffsiteDue({ hasBackup: true, lastDownloadAt: "2026-10-01T10:00:00Z", now })).toBe(true);
    expect(isOffsiteDue({ hasBackup: true, lastDownloadAt: "2026-11-10T10:00:00Z", now })).toBe(false);
  });

  it("stays quiet until there is a backup", () => {
    expect(isOffsiteDue({ hasBackup: false, lastDownloadAt: null, now })).toBe(false);
  });
});

describe("keepCountError", () => {
  it("accepts 1–52 whole backups", () => {
    expect(keepCountError("8")).toBeNull();
    expect(keepCountError(0)).toMatch(/1 ile 52/);
    expect(keepCountError("2.5")).toMatch(/1 ile 52/);
  });
});
