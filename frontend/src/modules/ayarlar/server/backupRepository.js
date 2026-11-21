import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";

// Backup reads and writes with the secret key: the nightly job has no signed-in user, the "backups" bucket
// is private to the server, and backup_runs can only be written by the server (RLS has no write rule).
// Callers check who is asking before using this file.

const BUCKET = "backups";
const PAGE_SIZE = 1000;
const OFFSITE_MARKER = "meta/last-download.txt";

// Ordering keys, so reading in pages of 1000 never skips or repeats a row. Every other table uses "id".
const ORDER_KEYS = {
  payment_methods: ["code"],
  patient_national_ids: ["patient_id"],
  stock_removals: ["stock_unit_id"],
  sale_tasks: ["sale_id", "link_id"],
};

function check({ data, error }) {
  if (error) throw error;
  return data;
}

export async function readTable(table) {
  const supabase = getAdminClient();
  const keys = ORDER_KEYS[table] ?? ["id"];
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select("*");
    for (const key of keys) query = query.order(key);
    const page = check(await query.range(from, from + PAGE_SIZE - 1)) ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function getBackupSettings() {
  return check(
    await getAdminClient()
      .from("settings")
      .select("backup_enabled, backup_weekday, backup_keep_count")
      .eq("id", 1)
      .single()
  );
}

export async function startRun(kind) {
  return check(await getAdminClient().from("backup_runs").insert({ kind }).select("id, started_at").single());
}

export async function finishRun(id, fields) {
  check(await getAdminClient().from("backup_runs").update({ ...fields, finished_at: new Date().toISOString() }).eq("id", id));
}

export async function clearRunFile(id) {
  check(await getAdminClient().from("backup_runs").update({ file_path: null }).eq("id", id));
}

export async function listRuns(limit) {
  let query = getAdminClient()
    .from("backup_runs")
    .select("id, kind, status, started_at, finished_at, file_path, size_bytes")
    .order("started_at", { ascending: false });
  if (limit) query = query.limit(limit);
  return check(await query) ?? [];
}

export async function getRun(id) {
  return check(
    await getAdminClient().from("backup_runs").select("id, status, file_path, started_at").eq("id", id).maybeSingle()
  );
}

export async function lastSuccessfulRun() {
  return check(
    await getAdminClient()
      .from("backup_runs")
      .select("id, started_at, finished_at")
      .eq("status", "succeeded")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  );
}

export async function uploadFile(path, body, contentType) {
  check(await getAdminClient().storage.from(BUCKET).upload(path, body, { contentType, upsert: false }));
}

export async function removeFiles(paths) {
  if (!paths.length) return;
  check(await getAdminClient().storage.from(BUCKET).remove(paths));
}

// A link that works for a few minutes, with the file name the browser should save it under.
export async function signedDownloadUrl(path, fileName) {
  const data = check(await getAdminClient().storage.from(BUCKET).createSignedUrl(path, 300, { download: fileName }));
  return data.signedUrl;
}

// The monthly "keep a copy outside Supabase" reminder needs the date of the last download. It lives as a
// tiny file in the same private bucket, so no table change is needed.
export async function markDownloaded(at) {
  check(
    await getAdminClient()
      .storage.from(BUCKET)
      .upload(OFFSITE_MARKER, new Blob([at], { type: "text/plain" }), { contentType: "text/plain", upsert: true })
  );
}

export async function lastDownloadAt() {
  const { data, error } = await getAdminClient().storage.from(BUCKET).download(OFFSITE_MARKER);
  if (error) return null; // no download yet
  const text = (await data.text()).trim();
  return Number.isNaN(new Date(text).getTime()) ? null : text;
}
