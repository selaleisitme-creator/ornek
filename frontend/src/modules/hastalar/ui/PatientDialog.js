"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/modules/shared/ui/Modal";
import PhoneInput from "@/modules/shared/ui/PhoneInput";
import { useToast } from "@/modules/shared/ui/Toast";
import { ADDRESS_MAX, NAME_MAX, patientInputError, splitPhone } from "../patientRules";
import { createPatient, updatePatient } from "../server/actions";

// "Yeni hasta kaydı" / "Hasta bilgilerini düzenle". As in the design, only name and phone are required; the
// rest can be filled in later. The TC number is optional: anyone may enter a missing one, but one on file
// can only be changed by someone with the ID permission (the field is hidden for everyone else).
export default function PatientDialog({ patient, open, onClose, referralSources = [] }) {
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(patient);
  const phoneParts = splitPhone(patient?.phone);

  const [form, setForm] = useState({
    fullName: patient?.name ?? "",
    phone: patient?.phone ?? "",
    birthDate: patient?.birthDate ?? "",
    address: patient?.address ?? "",
    referralSourceId: patient?.referralSourceId ? String(patient.referralSourceId) : "",
    whatsappConsent: patient?.whatsappConsent ?? false,
    nationalId: "",
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const idOnFile = Boolean(patient?.nationalId?.onFile);
  const canEnterId = !idOnFile || patient?.nationalId?.canView;
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  async function save(event) {
    event.preventDefault();
    const problem = patientInputError(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const result = editing ? await updatePatient(patient.id, form) : await createPatient(form);
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "Kaydedilemedi.");

    if (editing) {
      toast("Hasta bilgileri güncellendi.");
      onClose();
    } else {
      toast("Hasta kaydı oluşturuldu.");
      onClose();
      router.push(`/hastalar?ac=${result.data.id}`);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Hastalar"
      title={editing ? "Hasta bilgilerini düzenle" : "Yeni hasta kaydı"}
      footer={
        <>
          <button type="button" className="ui-button ui-button-ghost" onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" form="patient-form" className="ui-button ui-button-primary" disabled={busy}>
            {busy ? "Bekleyin…" : editing ? "Değişiklikleri kaydet" : "Hastayı kaydet"}
          </button>
        </>
      }
    >
      <form id="patient-form" className="patients-form" onSubmit={save} noValidate>
        {!editing && (
          <p className="patients-hint">
            Zorunlu alanlar: ad soyad ve telefon. Cihaz, garanti ve takip bilgileri satış yapıldığında hasta kartına
            eklenir.
          </p>
        )}

        <label className="ui-field patients-form-wide" htmlFor="patient-name">
          <span className="ui-label">Ad soyad *</span>
          <input
            id="patient-name"
            className="ui-input"
            value={form.fullName}
            maxLength={NAME_MAX}
            autoComplete="off"
            required
            autoFocus
            onChange={set("fullName")}
          />
        </label>

        <div className="patients-form-wide">
          <PhoneInput
            id="patient-phone"
            label="Telefon numarası *"
            defaultCountry={phoneParts.country}
            defaultNumber={phoneParts.number}
            required
            onChange={(phone) => setForm((current) => ({ ...current, phone: phone ?? "" }))}
          />
        </div>

        <label className="ui-field" htmlFor="patient-birth">
          <span className="ui-label">Doğum tarihi</span>
          <input id="patient-birth" className="ui-input" type="date" value={form.birthDate} onChange={set("birthDate")} />
        </label>

        <label className="ui-field" htmlFor="patient-source">
          <span className="ui-label">Bizi nereden duydu?</span>
          <select id="patient-source" className="ui-input" value={form.referralSourceId} onChange={set("referralSourceId")}>
            <option value="">Seçilmedi</option>
            {referralSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>

        <label className="ui-field patients-form-wide" htmlFor="patient-address">
          <span className="ui-label">Adres</span>
          <input
            id="patient-address"
            className="ui-input"
            value={form.address}
            maxLength={ADDRESS_MAX}
            autoComplete="off"
            onChange={set("address")}
          />
        </label>

        {canEnterId ? (
          <label className="ui-field patients-form-wide" htmlFor="patient-national-id">
            <span className="ui-label">{idOnFile ? "TC kimlik no (değiştirmek için yeni numarayı yazın)" : "TC kimlik no"}</span>
            <input
              id="patient-national-id"
              className="ui-input"
              inputMode="numeric"
              autoComplete="off"
              maxLength={11}
              placeholder={idOnFile ? (patient.nationalId.masked ?? "Kayıtlı") : "11 haneli numara"}
              value={form.nationalId}
              onChange={(event) => setForm({ ...form, nationalId: event.target.value.replace(/\D/g, "") })}
            />
          </label>
        ) : (
          <p className="patients-hint patients-form-wide">TC kimlik numarası kayıtlı. Değiştirmek için TC izni gerekir.</p>
        )}

        <label className="patients-check patients-form-wide">
          <input
            type="checkbox"
            checked={form.whatsappConsent}
            onChange={(event) => setForm({ ...form, whatsappConsent: event.target.checked })}
          />
          <span>WhatsApp üzerinden bilgilendirme izni var</span>
        </label>

        {error && (
          <p className="ui-error patients-form-wide" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
