"use client";

import { useActionState } from "react";
import { saveGeneralSettings } from "../server/actions";
import { useResultToast } from "./useResultToast";

// Maintenance follow-up and appointment reminders. The WhatsApp number has its own card.
export default function GeneralSettingsForm({ settings }) {
  const [result, submit, pending] = useActionState(saveGeneralSettings, null);
  useResultToast(result, "Ayarlar kaydedildi.");

  return (
    <form action={submit} className="settings-card">
      <header>
        <h2>Genel</h2>
        <p>Bakım takibi ve randevu hatırlatmaları.</p>
      </header>

      <label className="ui-field" htmlFor="maintenance">
        <span className="ui-label">Bakım iletişim aralığı (ay)</span>
        <input
          id="maintenance"
          className="ui-input settings-number"
          name="maintenance_interval_months"
          type="number"
          min={1}
          max={36}
          defaultValue={settings.maintenance_interval_months}
          required
        />
        <span className="settings-hint">Son bakımdan bu kadar ay sonra hasta Anasayfa&apos;da &ldquo;bakım zamanı&rdquo; olarak görünür.</span>
      </label>

      <fieldset className="settings-checks">
        <legend className="ui-label">Randevu hatırlatmaları (WhatsApp taslağı)</legend>
        <label><input type="checkbox" name="reminders_enabled" defaultChecked={settings.reminders_enabled} /> Hatırlatmalar açık</label>
        <label><input type="checkbox" name="remind_3d" defaultChecked={settings.remind_3d} /> 3 gün kala</label>
        <label><input type="checkbox" name="remind_1d" defaultChecked={settings.remind_1d} /> 1 gün kala</label>
        <label><input type="checkbox" name="remind_1h" defaultChecked={settings.remind_1h} /> 1 saat kala</label>
      </fieldset>

      <footer>
        <button type="submit" className="ui-button ui-button-primary" disabled={pending}>
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </footer>
    </form>
  );
}
