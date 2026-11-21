"use client";

import { useState } from "react";
import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { useToast } from "@/modules/shared/ui/Toast";
import { useStepUpAction } from "@/modules/shared/ui/useStepUpAction";
import { formatDateTime } from "@/lib/dates";
import { KEEP_MAX, KEEP_MIN, WEEKDAYS, formatBytes, keepCountError } from "../backupRules";
import { getBackupDownloadLink, runBackupNow, saveBackupSettings } from "../server/actions";

// "Yedekleme" (son.html Ayarlar > Yedekleme, Faz 6b): what is backed up and where, the weekly schedule, the
// last backups, and for the admin "Şimdi yedekle" and downloads. Every staff member sees and edits the
// schedule; the files themselves are the admin's (they hold every patient and the cash ledger).
const STATUS = {
  succeeded: { tone: "ok", label: "Başarılı" },
  failed: { tone: "danger", label: "Başarısız" },
  running: { tone: "info", label: "Sürüyor" },
};

export default function BackupCard({ backup, isAdmin }) {
  const toast = useToast();
  const { run, stepUpDialog } = useStepUpAction();
  const [enabled, setEnabled] = useState(backup.enabled);
  const [weekday, setWeekday] = useState(String(backup.weekday));
  const [keepCount, setKeepCount] = useState(String(backup.keepCount));
  const [busy, setBusy] = useState(null); // "save" | "backup" | "<runId>-<format>"
  const [error, setError] = useState(null);

  async function save(event) {
    event.preventDefault();
    const problem = keepCountError(keepCount);
    if (problem) return setError(problem);
    setBusy("save");
    setError(null);
    const result = await saveBackupSettings({ enabled, weekday, keepCount });
    setBusy(null);
    if (!result?.ok) return setError(result?.error ?? "Kaydedilemedi.");
    toast("Yedekleme ayarları kaydedildi.");
  }

  async function backupNow() {
    setBusy("backup");
    setError(null);
    const result = await runBackupNow();
    setBusy(null);
    if (!result?.ok) return setError(result?.error ?? "Yedek alınamadı.");
    toast(`Yedek alındı (${result.data.rows} kayıt).`);
  }

  async function download(runId, format) {
    setBusy(`${runId}-${format}`);
    setError(null);
    const result = await run(getBackupDownloadLink, runId, format);
    setBusy(null);
    if (result?.cancelled) return;
    if (!result?.ok) return setError(result?.error ?? "Bağlantı alınamadı.");
    // The link is valid for five minutes and names the file, so the browser saves it directly.
    window.location.assign(result.data);
  }

  return (
    <section className="settings-card settings-wide backup-card" aria-labelledby="backup-title">
      <header className="backup-head">
        <div>
          <h2 id="backup-title">Yedekleme</h2>
          <p>Hasta, stok, satış, randevu ve muhasebe kayıtları haftada bir otomatik olarak saklanır.</p>
        </div>
        <span className="backup-tag">Excel + JSON</span>
      </header>

      <div className="backup-overview">
        <article>
          <span>Yedek içeriği</span>
          <b>Tüm panel kayıtları</b>
          <p>JSON tam kopyadır; Excel her tabloyu ayrı sayfada gösterir. TC numaraları şifreli kalır, fotoğraflar kendi deposunda durur, giriş şifreleri yedeğe girmez.</p>
        </article>
        <article>
          <span>Kayıt yeri</span>
          <b>Supabase gizli klasörü</b>
          <p>Son {backup.keepCount} yedek saklanır, daha eskiler kendiliğinden silinir. Ayda bir yedeği indirip Drive&apos;da saklayın.</p>
        </article>
        <article>
          <span>Çalışma şekli</span>
          <b>Her {WEEKDAYS[backup.weekday]?.toLocaleLowerCase("tr-TR")} gecesi 03:00 civarı</b>
          <p>Panelin açık olması gerekmez. Kaçan bir hafta ertesi gece tamamlanır.</p>
        </article>
      </div>

      {backup.offsiteDue && isAdmin && (
        <p className="backup-offsite" role="status">
          <b>Bu ayın dış yedeği bekliyor.</b> Aşağıdan son yedeğin Excel ve JSON dosyalarını indirip Google Drive&apos;a ya da
          bilgisayara kaydedin. {backup.lastDownloadAt ? `Son indirme: ${formatDateTime(backup.lastDownloadAt)}.` : "Henüz hiç indirilmedi."}
        </p>
      )}

      <form className="backup-schedule" onSubmit={save}>
        <label className="backup-switch">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Otomatik haftalık yedek açık
        </label>
        <label className="ui-field" htmlFor="backup-weekday">
          <span className="ui-label">Yedek günü</span>
          <select id="backup-weekday" className="ui-input" value={weekday} onChange={(event) => setWeekday(event.target.value)}>
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </label>
        <label className="ui-field" htmlFor="backup-keep">
          <span className="ui-label">Saklanacak yedek</span>
          <input
            id="backup-keep"
            className="ui-input settings-number"
            type="number"
            min={KEEP_MIN}
            max={KEEP_MAX}
            value={keepCount}
            onChange={(event) => setKeepCount(event.target.value)}
          />
        </label>
        <button type="submit" className="ui-button ui-button-primary" disabled={busy === "save"}>
          {busy === "save" ? "Bekleyin…" : "Kaydet"}
        </button>
      </form>

      <div className="backup-list-head">
        <h3>Son yedekler</h3>
        {isAdmin && (
          <button type="button" className="ui-button ui-button-ghost" onClick={backupNow} disabled={busy === "backup"}>
            {busy === "backup" ? "Yedek alınıyor…" : "Şimdi yedekle"}
          </button>
        )}
      </div>

      {backup.runs.length ? (
        <ul className="backup-list">
          {backup.runs.map((entry) => {
            const status = STATUS[entry.status] ?? STATUS.running;
            return (
              <li key={entry.id}>
                <div className="backup-list-main">
                  <b>{formatDateTime(entry.startedAt)}</b>
                  <span>
                    {entry.kind === "manual" ? "Elle" : "Otomatik"} · {entry.hasFile ? formatBytes(entry.sizeBytes) : entry.status === "succeeded" ? "Dosya silindi (saklama sınırı)" : "Dosya yok"}
                  </span>
                </div>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                {isAdmin && entry.hasFile && (
                  <div className="backup-downloads">
                    {["xlsx", "json"].map((format) => (
                      <button
                        key={format}
                        type="button"
                        className="ui-button ui-button-ghost"
                        onClick={() => download(entry.id, format)}
                        disabled={busy === `${entry.id}-${format}`}
                      >
                        {busy === `${entry.id}-${format}` ? "Hazırlanıyor…" : format === "xlsx" ? "Excel indir" : "JSON indir"}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="backup-empty">Henüz yedek alınmadı. İlk otomatik yedek bu gece alınır{isAdmin ? "; hemen almak için \"Şimdi yedekle\"ye basın" : ""}.</p>
      )}

      {!isAdmin && <p className="settings-hint">Yedek dosyalarını yalnızca yönetici indirebilir.</p>}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      <p className="backup-note">
        <b>Geri yükleme:</b> panelde geri yükleme düğmesi yoktur; gerekirse JSON dosyasından elle yapılır. TC numaralarını okumak için
        NATIONAL_ID_KEY anahtarının ayrıca güvenli bir yerde saklanması gerekir.
      </p>
      {stepUpDialog}
    </section>
  );
}
