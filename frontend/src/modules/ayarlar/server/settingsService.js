import "server-only";
import { updateSettings } from "./settingsRepository";

// Business rules for the settings form. Input arrives from the browser, so every value is checked
// here again; the database CHECK rules are the last line, not the only one.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

function wholeNumber(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ValidationError(`${label} ${min} ile ${max} arasında bir tam sayı olmalı.`);
  }
  return number;
}

export async function saveGeneralSettings(form) {
  const whatsapp = String(form.get("whatsapp_number") ?? "").trim();
  if (whatsapp && !/^\+\d{8,15}$/.test(whatsapp)) {
    throw new ValidationError("WhatsApp numarasını ülke koduyla birlikte girin.");
  }

  await updateSettings({
    whatsapp_number: whatsapp || null,
    maintenance_interval_months: wholeNumber(form.get("maintenance_interval_months"), 1, 36, "Bakım aralığı"),
    reminders_enabled: form.get("reminders_enabled") === "on",
    remind_3d: form.get("remind_3d") === "on",
    remind_1d: form.get("remind_1d") === "on",
    remind_1h: form.get("remind_1h") === "on",
  });
}

export async function saveSecuritySettings(form) {
  await updateSettings({
    idle_logout_minutes: wholeNumber(form.get("idle_logout_minutes"), 5, 480, "Otomatik çıkış süresi"),
  });
}
