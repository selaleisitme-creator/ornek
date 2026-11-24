"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/modules/shared/ui/Modal";
import ConfirmDialog from "@/modules/shared/ui/ConfirmDialog";
import { useToast } from "@/modules/shared/ui/Toast";
import { useWhatsAppLink } from "@/modules/shared/ui/useWhatsAppLink";
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, noteInputError, whatsappGreeting } from "../patientRules";
import {
  addPatientNote,
  logWhatsAppContact,
  promoteCandidate,
  removePatient,
  revealNationalId,
  setAdaptationStart,
} from "../server/actions";
import PatientDialog from "./PatientDialog";

// The patient card's buttons. Each one owns its small window, so the card itself stays a server component.

// Opens a WhatsApp draft (a person presses send) and logs the contact. Without recorded consent it first asks
// for confirmation, as in the design, and records the consent with the contact.
export function WhatsAppButton({ patient }) {
  const toast = useToast();
  const link = useWhatsAppLink(patient.phone, whatsappGreeting(patient.name));
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!link) return null;

  async function log(options) {
    const result = await logWhatsAppContact(patient.id, options);
    if (!result?.ok) toast(result?.error ?? "İletişim kaydedilemedi.", "error");
    return result;
  }

  if (patient.whatsappConsent) {
    return (
      <a className="ui-button patients-whatsapp" href={link} target="_blank" rel="noopener noreferrer" onClick={() => log()}>
        WhatsApp
      </a>
    );
  }

  return (
    <>
      <button type="button" className="ui-button patients-whatsapp" onClick={() => setAsking(true)}>
        WhatsApp
      </button>
      <ConfirmDialog
        open={asking}
        title="WhatsApp izni"
        message="Bu hastanın WhatsApp üzerinden iletişim izni olduğunu onaylıyor musunuz? Onay hasta kartına kaydedilir."
        confirmLabel="Onayla ve WhatsApp'ı aç"
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={async () => {
          // Opened before the request: a window opened after an await is blocked as a pop-up.
          window.open(link, "_blank", "noopener,noreferrer");
          setBusy(true);
          const result = await log({ confirmConsent: true });
          setBusy(false);
          setAsking(false);
          if (result?.ok) toast("WhatsApp izni kaydedildi.");
        }}
      />
    </>
  );
}

export function EditPatientButton({ patient }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ui-button ui-button-ghost" onClick={() => setOpen(true)}>
        ✎ Bilgileri düzenle
      </button>
      <PatientDialog
        key={open ? "open" : "closed"}
        patient={patient}
        referralSources={patient.referralSources}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export function NoteButton({ patient }) {
  // The card has two "Not ekle" buttons (header and notes section); each window needs its own ids, or the
  // second window's "Notu kaydet" would submit the first window's form.
  const uid = useId();
  const formId = `patient-note-form-${uid}`;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("Kontrol notu");
  const [body, setBody] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function start() {
    setTitle("Kontrol notu");
    setBody("");
    setError(null);
    setOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    const problem = noteInputError({ title, body });
    if (problem) return setError(problem);
    setBusy(true);
    const result = await addPatientNote(patient.id, { title, body });
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "Not kaydedilemedi.");
    toast("Hasta notu kaydedildi.");
    setOpen(false);
  }

  return (
    <>
      <button type="button" className="ui-button ui-button-primary" onClick={start}>
        ＋ Not ekle
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow={patient.name}
        title="Hasta notu ekle"
        footer={
          <>
            <button type="button" className="ui-button ui-button-ghost" onClick={() => setOpen(false)}>
              Vazgeç
            </button>
            <button type="submit" form={formId} className="ui-button ui-button-primary" disabled={busy}>
              {busy ? "Bekleyin…" : "Notu kaydet"}
            </button>
          </>
        }
      >
        <form id={formId} className="ui-stack" onSubmit={save} noValidate>
          <label className="ui-field" htmlFor={`${formId}-title`}>
            <span className="ui-label">Not başlığı</span>
            <input
              id={`${formId}-title`}
              className="ui-input"
              placeholder="Örn. Kontrol görüşmesi"
              value={title}
              maxLength={NOTE_TITLE_MAX}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="ui-field" htmlFor={`${formId}-body`}>
            <span className="ui-label">Not</span>
            <textarea
              id={`${formId}-body`}
              className="ui-input patients-textarea"
              rows={5}
              placeholder="Görüşme veya bakım notunu yazın…"
              value={body}
              maxLength={NOTE_BODY_MAX}
              autoFocus
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </Modal>
    </>
  );
}

// The adaptation start date typed by hand (patients.adaptation_start_manual). Empty goes back to the sale date.
export function AdaptationButton({ patient }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(patient.adaptationStartManual ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await setAdaptationStart(patient.id, date);
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "Kaydedilemedi.");
    toast(date ? "Adaptasyon başlangıcı kaydedildi." : "Adaptasyon satış tarihine göre hesaplanacak.");
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="ui-button ui-button-ghost"
        onClick={() => {
          setDate(patient.adaptationStartManual ?? "");
          setError(null);
          setOpen(true);
        }}
      >
        ✎ Adaptasyon tarihi
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow={patient.name}
        title="Adaptasyon başlangıcı"
        size="sm"
        footer={
          <>
            <button type="button" className="ui-button ui-button-ghost" onClick={() => setOpen(false)}>
              Vazgeç
            </button>
            <button type="submit" form="patient-adaptation-form" className="ui-button ui-button-primary" disabled={busy}>
              {busy ? "Bekleyin…" : "Kaydet"}
            </button>
          </>
        }
      >
        <form id="patient-adaptation-form" className="ui-stack" onSubmit={save} noValidate>
          <p className="patients-hint">
            Satış yapıldığında adaptasyon cihaz satış tarihinden başlar. Farklı bir tarih gerekiyorsa buraya yazın; boş
            bırakırsanız satış tarihi kullanılır.
          </p>
          <label className="ui-field" htmlFor="adaptation-start">
            <span className="ui-label">Başlangıç tarihi</span>
            <input id="adaptation-start" className="ui-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          {date && (
            <button type="button" className="patients-link-button" onClick={() => setDate("")}>
              Tarihi temizle (satış tarihini kullan)
            </button>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </Modal>
    </>
  );
}

export function PromoteButton({ patient }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button type="button" className="ui-button ui-button-primary" onClick={() => setAsking(true)}>
        Hastaya dönüştür
      </button>
      <ConfirmDialog
        open={asking}
        title="Hastaya dönüştür"
        message={`${patient.name} hasta kayıtlarına taşınır. Satış veya cihaz kaydı eklenmez.`}
        confirmLabel="Hastaya dönüştür"
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={async () => {
          setBusy(true);
          const result = await promoteCandidate(patient.id);
          setBusy(false);
          setAsking(false);
          if (!result?.ok) return toast(result?.error ?? "Dönüştürülemedi.", "error");
          toast("Kişi hasta kayıtlarına taşındı.");
        }}
      />
    </>
  );
}

export function RemovePatientButton({ patient }) {
  const router = useRouter();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button type="button" className="ui-button ui-button-danger" onClick={() => setAsking(true)}>
        Hasta kaydını sil
      </button>
      <ConfirmDialog
        open={asking}
        title="Hasta kaydını sil"
        message={`${patient.name} hasta listesinden kaldırılır. Satış, randevu ve muhasebe kayıtları korunur.`}
        confirmLabel="Kaydı sil"
        danger
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={async () => {
          setBusy(true);
          const result = await removePatient(patient.id);
          setBusy(false);
          setAsking(false);
          if (!result?.ok) return toast(result?.error ?? "Silinemedi.", "error");
          toast("Hasta kaydı silindi.");
          router.replace("/hastalar");
        }}
      />
    </>
  );
}

// "TC kayıtlı" for everyone; the masked number and a "Göster" button for users with the ID permission.
// Showing the full number is logged in the database (national_id_views).
export function NationalIdValue({ patient }) {
  const { nationalId } = patient;
  const [value, setValue] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!nationalId.onFile) return "Kayıtlı değil";
  if (!nationalId.canView) return "Kayıtlı";
  if (value) return <span className="patients-mono">{value}</span>;

  return (
    <span className="patients-national-id">
      <span className="patients-mono">{nationalId.masked ?? "Kayıtlı"}</span>
      <button
        type="button"
        className="patients-link-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const result = await revealNationalId(patient.id);
          setBusy(false);
          if (!result?.ok) return setError(result?.error ?? "Gösterilemedi.");
          setValue(result.data);
        }}
      >
        {busy ? "Bekleyin…" : "Göster"}
      </button>
      {error && <span className="ui-error">{error}</span>}
    </span>
  );
}
