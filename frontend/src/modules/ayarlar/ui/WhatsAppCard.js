"use client";

import { useActionState } from "react";
import PhoneInput from "@/modules/shared/ui/PhoneInput";
import { COUNTRY_CODES, formatPhone } from "@/lib/phone";
import { useWhatsAppLink } from "@/modules/shared/ui/useWhatsAppLink";
import { saveWhatsAppNumber } from "../server/actions";
import { useResultToast } from "./useResultToast";

// Longest country codes first, so "+994…" is not read as "+9…".
const CODES_LONGEST_FIRST = COUNTRY_CODES.map((c) => c.code).sort((a, b) => b.length - a.length);

// "+905321234567" → { country: "+90", number: "5321234567" } for the phone box.
function splitPhone(phone) {
  const country = CODES_LONGEST_FIRST.find((code) => phone?.startsWith(code));
  return country ? { country, number: phone.slice(country.length) } : { country: "+90", number: "" };
}

// The clinic number used for WhatsApp drafts (appointment reminders, maintenance messages).
// "WhatsApp'ı aç" opens a chat with the saved number, so a typo shows up at once.
export default function WhatsAppCard({ whatsappNumber }) {
  const [result, submit, pending] = useActionState(saveWhatsAppNumber, null);
  useResultToast(result, "WhatsApp numarası kaydedildi.");
  const phone = splitPhone(whatsappNumber);
  const link = useWhatsAppLink(whatsappNumber);

  return (
    <form action={submit} className="settings-card">
      <header>
        <h2>WhatsApp</h2>
        <p>Hatırlatma ve bakım mesajlarının taslağı bu numarayla açılır; mesajı siz gönderirsiniz.</p>
      </header>

      <PhoneInput
        id="whatsapp"
        name="whatsapp_number"
        label="Klinik WhatsApp numarası"
        defaultCountry={phone.country}
        defaultNumber={phone.number}
      />

      <p className="settings-hint" style={{ margin: 0 }}>
        Kayıtlı numara: <strong>{whatsappNumber ? formatPhone(whatsappNumber) : "henüz girilmedi"}</strong>
      </p>

      <footer>
        {link ? (
          <a className="ui-button ui-button-ghost" href={link} target="_blank" rel="noopener noreferrer">
            WhatsApp&apos;ı aç ↗
          </a>
        ) : (
          <button type="button" className="ui-button ui-button-ghost" disabled>
            WhatsApp&apos;ı aç
          </button>
        )}
        <button type="submit" className="ui-button ui-button-primary" disabled={pending}>
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </footer>
    </form>
  );
}
