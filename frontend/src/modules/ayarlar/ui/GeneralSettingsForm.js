"use client";

import { useActionState } from "react";
import PhoneInput from "@/modules/shared/ui/PhoneInput";
import { saveGeneralSettings } from "../server/actions";
import { useResultToast } from "./useResultToast";

// Splits "+905321234567" back into country code and number for the phone box.
function splitPhone(phone) {
  const match = /^(\+(?:994|995|359|90|49|44|33|31|32|43|41|30|1))(\d+)$/.exec(phone ?? "");
  return match ? { country: match[1], number: match[2] } : { country: "+90", number: "" };
}

export default function GeneralSettingsForm({ settings }) {
  const [result, submit, pending] = useActionState(saveGeneralSettings, null);
  useResultToast(result, "Ayarlar kaydedildi.");
  const phone = splitPhone(settings.whatsapp_number);

  return (
    <form action={submit} className="settings-card">
      <header>
        <h2>Genel</h2>
        <p>Hasta iletişimi ve randevu hatırlatmaları.</p>
      </header>

      <PhoneInput
        id="whatsapp"
        name="whatsapp_number"
        label="Klinik WhatsApp numarası"
        defaultCountry={phone.country}
        defaultNumber={phone.number}
      />

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
