"use client";

import Link from "next/link";
import { useWhatsAppLink } from "@/modules/shared/ui/useWhatsAppLink";

// One patient inside a suggestion: name, why they are listed, and the next step. The WhatsApp button only
// opens a draft; the message is sent by a person. Saving the contact as a maintenance contact comes with the
// patient card (Faz 2), which owns patient_contacts.
export default function SuggestionPatient({ patient }) {
  const whatsapp = useWhatsAppLink(patient.whatsappText ? patient.phone : null, patient.whatsappText ?? "");

  return (
    <div className="home-patient-row">
      <div className="home-patient-info">
        <b>{patient.name}</b>
        <span>
          {patient.note}
          {patient.phone ? ` · ${patient.phone}` : ""}
        </span>
      </div>
      <div className="home-patient-actions">
        <Link className="home-patient-button" href={`/hastalar?ac=${patient.id}`}>
          Hasta kartını aç
        </Link>
        {whatsapp && (
          <a className="home-patient-button" href={whatsapp} target="_blank" rel="noopener noreferrer">
            WhatsApp taslağı hazırla
          </a>
        )}
        {patient.bookAppointment && (
          <Link className="home-patient-button" href={`/randevular?yeni=${patient.id}&tur=checkup`}>
            Randevu oluştur
          </Link>
        )}
      </div>
    </div>
  );
}
