"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTime } from "@/lib/dates";
import { useWhatsAppLink } from "./useWhatsAppLink";
import { useToast } from "./Toast";
import { checkAppointmentReminders, markAppointmentReminderSent } from "@/modules/randevular/server/actions";
import "./appointment-reminder-popup.css";

function reminderMessage(reminder) {
  const dateTime = formatDateTime(reminder.startsAt);
  return `Merhaba ${reminder.patientName}, Şelale İşitme'den hatırlatma: ${dateTime} saatinde ${reminder.kindName} randevunuz bulunmaktadır. İyi günler.`;
}

export default function AppointmentReminderPopup() {
  const toast = useToast();
  const [reminder, setReminder] = useState(null);
  const [saving, setSaving] = useState(false);
  const href = useWhatsAppLink(reminder?.phone ?? null, reminder ? reminderMessage(reminder) : "");

  const check = useCallback(async () => {
    if (reminder) return;
    const result = await checkAppointmentReminders();
    if (!result?.ok) {
      toast(result?.error ?? "Randevu hatırlatmaları kontrol edilemedi.", "error");
      return;
    }
    if (result.data) setReminder(result.data);
  }, [reminder, toast]);

  useEffect(() => {
    const initial = window.setTimeout(check, 0);
    const timer = window.setInterval(check, 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [check]);

  async function openDraft() {
    if (!reminder || !href || saving) return;
    const opened = window.open(href, "_blank", "noopener,noreferrer");
    if (!opened) {
      toast("WhatsApp taslağı açılamadı. Tarayıcının açılır pencere iznini kontrol edin.", "error");
      return;
    }
    setSaving(true);
    const result = await markAppointmentReminderSent(reminder.appointmentId, reminder.offset);
    setSaving(false);
    if (!result?.ok) {
      toast(result?.error ?? "Hatırlatma kaydedilemedi.", "error");
      return;
    }
    setReminder(null);
  }

  if (!reminder) return null;
  const [date, time] = formatDateTime(reminder.startsAt).split(" ");

  return (
    <aside id="appReminderPopup" role="dialog" aria-label="Randevu hatırlatması">
      <div className="reminder-popup-head">
        <div>
          <span className="reminder-popup-tag">{reminder.label}</span>
          <h2>{reminder.patientName} için randevu</h2>
        </div>
        <button
          type="button"
          className="close-reminder"
          aria-label="Hatırlatmayı beş dakika ertele"
          title="Beş dakika sonra yeniden göster"
          onClick={() => setReminder(null)}
        >
          ✕
        </button>
      </div>
      <p>{date} · {time}</p>
      <p>{reminder.kindName}</p>
      <div className="reminder-popup-actions">
        <button type="button" className="primary" disabled={!href || saving} onClick={openDraft}>
          {saving ? "Açılıyor…" : "WhatsApp taslağını aç"}
        </button>
      </div>
    </aside>
  );
}
