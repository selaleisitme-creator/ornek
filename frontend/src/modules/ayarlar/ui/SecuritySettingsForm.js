"use client";

import { useActionState } from "react";
import { saveSecuritySettings } from "../server/actions";
import { useResultToast } from "./useResultToast";

// Admin only (the page does not render it for others, the action and the database check again).
export default function SecuritySettingsForm({ idleLogoutMinutes }) {
  const [result, submit, pending] = useActionState(saveSecuritySettings, null);
  useResultToast(result, "Güvenlik ayarı kaydedildi.");

  return (
    <form action={submit} className="settings-card">
      <header>
        <h2>Güvenlik</h2>
        <p>Klinikteki ortak bilgisayar için.</p>
      </header>

      <label className="ui-field" htmlFor="idle">
        <span className="ui-label">Hareketsizlikte otomatik çıkış (dakika)</span>
        <input
          id="idle"
          className="ui-input settings-number"
          name="idle_logout_minutes"
          type="number"
          min={5}
          max={480}
          defaultValue={idleLogoutMinutes}
          required
        />
        <span className="settings-hint">Bu süre boyunca hiçbir şeye dokunulmazsa panel kendiliğinden çıkış yapar.</span>
      </label>

      <footer>
        <button type="submit" className="ui-button ui-button-primary" disabled={pending}>
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </footer>
    </form>
  );
}
