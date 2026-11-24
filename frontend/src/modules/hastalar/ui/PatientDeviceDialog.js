"use client";

import { useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { useToast } from "@/modules/shared/ui/Toast";
import { useStepUpAction } from "@/modules/shared/ui/useStepUpAction";
import { formatDate, todayInClinic } from "@/lib/dates";
import { DEVICE_EAR_SIDES, buildFollowupUpdate } from "../deviceRules";
import { loadDeviceCatalog, updateDeviceFollowup } from "../server/actions";
import DeviceReplaceForm from "./DeviceReplaceForm";
import LegacyDeviceForm from "./LegacyDeviceForm";
import "./patient-devices.css";

function deviceLine(device) {
  return [device.serial && `Seri: ${device.serial}`, device.legacy ? "Panel öncesi satış" : `Satış: ${formatDate(device.saleDate)}`]
    .filter(Boolean)
    .join(" · ");
}

// "Cihaz ve takip bilgileri" as in son.html, but every field is tied to a real record (plan section 1): devices come
// from sales, so they are swapped or added through the two sub-forms, never typed in; the patient status is shown,
// not chosen, because patient_overview works it out.
//   patient: { id, name, candidate, adaptationStartManual }; devices: currentDevices(...); statusText: statusLabel(...)
export default function PatientDeviceDialog({ patient, devices, statusText, onClose }) {
  const toast = useToast();
  const { run, stepUpDialog } = useStepUpAction();
  const today = todayInClinic();
  const [mode, setMode] = useState({ kind: "main" }); // main | replace (with device) | legacy
  const [catalog, setCatalog] = useState(null);
  const [adaptationStart, setAdaptationStart] = useState(patient.adaptationStartManual ?? "");
  const [rows, setRows] = useState(() =>
    devices.map((device) => ({ saleItemId: device.saleItemId, earSide: device.earSide ?? "", warrantyEnd: device.warrantyEnd ?? "" }))
  );
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function setRow(saleItemId, key, value) {
    setRows((current) => current.map((row) => (row.saleItemId === saleItemId ? { ...row, [key]: value } : row)));
  }

  // The brand and model lists are only needed by the two sub-forms, so they load when one of them opens.
  async function open(next) {
    setError(null);
    if (!catalog) {
      const result = await loadDeviceCatalog();
      if (!result?.ok) return setError(result?.error ?? "Model listesi yüklenemedi.");
      setCatalog(result.data);
    }
    setMode(next);
  }

  function finished(message) {
    toast(message);
    onClose();
  }

  async function save(event) {
    event.preventDefault();
    const input = { adaptationStart, devices: rows };
    const check = buildFollowupUpdate(input, { current: devices, today });
    if (check.error) return setError(check.error);
    setBusy(true);
    setError(null);
    const result = await updateDeviceFollowup(patient.id, input);
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "Kaydedilemedi.");
    finished("Cihaz ve takip bilgileri kaydedildi.");
  }

  const main = mode.kind === "main";
  const footer = main ? (
    <>
      <button type="button" className="ui-button ui-button-ghost" onClick={onClose}>Vazgeç</button>
      <button type="submit" form="device-followup-form" className="ui-button ui-button-primary" disabled={busy}>
        {busy ? "Bekleyin…" : "Değişiklikleri kaydet"}
      </button>
    </>
  ) : null;

  const title = main ? "Cihaz ve takip bilgileri" : mode.kind === "replace" ? "Cihazı değiştir" : "Geçmiş cihaz ekle";

  return (
    <Modal open onClose={onClose} eyebrow={patient.name} title={title} size="lg" footer={footer}>
      {main && (
        <form id="device-followup-form" className="device-dialog" onSubmit={save} noValidate>
          <p className="device-note">
            Cihaz satışı kaydedildiğinde adaptasyon tarihi otomatik belirlenir. Değişiklikler hasta kartına ve satış kaydına işlenir.
          </p>

          <section className="device-panel" aria-labelledby="device-identity">
            <h3 id="device-identity">Cihaz kimliği</h3>
            {devices.length ? (
              devices.map((device) => (
                <div key={device.saleItemId} className="device-row">
                  <div>
                    <b>{device.name ?? "Cihaz bilgisi eksik"}</b>
                    <small>{deviceLine(device)}</small>
                  </div>
                  <button type="button" className="ui-button ui-button-ghost" onClick={() => open({ kind: "replace", device })}>
                    ⇄ Cihazı değiştir
                  </button>
                </div>
              ))
            ) : (
              <p className="device-muted">Henüz cihaz yok. Satış yapıldığında cihaz buraya kendiliğinden gelir.</p>
            )}
            {patient.candidate ? (
              <p className="device-muted">Aday kayda geçmiş cihaz eklenemez; önce hastaya dönüştürün.</p>
            ) : (
              <button type="button" className="device-link" onClick={() => open({ kind: "legacy" })}>
                ＋ Geçmiş cihaz ekle (panelden önce satılmış)
              </button>
            )}
          </section>

          {devices.length > 0 && (
            <section className="device-panel ears" aria-labelledby="device-ears">
              <h3 id="device-ears">Kulak eşleşmesi</h3>
              <div className="device-grid">
                {devices.map((device) => {
                  const row = rows.find((item) => item.saleItemId === device.saleItemId);
                  const id = `device-side-${device.saleItemId}`;
                  return (
                    <label key={device.saleItemId} className="ui-field" htmlFor={id}>
                      <span className="ui-label">{device.name ?? "Cihaz"}{device.serial ? ` · ${device.serial}` : ""}</span>
                      <select id={id} className="ui-input" value={row?.earSide ?? ""} onChange={(event) => setRow(device.saleItemId, "earSide", event.target.value)}>
                        <option value="">Taraf belirtilmedi</option>
                        {DEVICE_EAR_SIDES.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          <section className="device-panel dates" aria-labelledby="device-dates">
            <h3 id="device-dates">Takip tarihleri</h3>
            <div className="device-grid">
              <label className="ui-field" htmlFor="device-adaptation">
                <span className="ui-label">Adaptasyon başlangıcı</span>
                <input id="device-adaptation" className="ui-input" type="date" max={today} value={adaptationStart} onChange={(event) => setAdaptationStart(event.target.value)} />
                {adaptationStart ? (
                  <button type="button" className="device-link" onClick={() => setAdaptationStart("")}>
                    Tarihi temizle (satış tarihini kullan)
                  </button>
                ) : (
                  <small className="device-muted">Boşsa son cihaz satışının tarihi kullanılır.</small>
                )}
              </label>
              {devices.map((device) => {
                const row = rows.find((item) => item.saleItemId === device.saleItemId);
                const id = `device-warranty-${device.saleItemId}`;
                return (
                  <label key={device.saleItemId} className="ui-field" htmlFor={id}>
                    <span className="ui-label">Garanti bitişi · {device.name ?? "Cihaz"}</span>
                    <input id={id} className="ui-input" type="date" min={device.warrantyStart ?? undefined} value={row?.warrantyEnd ?? ""} onChange={(event) => setRow(device.saleItemId, "warrantyEnd", event.target.value)} />
                  </label>
                );
              })}
            </div>
          </section>

          <section className="device-panel" aria-labelledby="device-status">
            <h3 id="device-status">Hasta durumu</h3>
            <div className="device-status">
              <StatusBadge tone={statusText.tone}>{statusText.label}</StatusBadge>
              <small className="device-muted">
                Durum kayıtlardan hesaplanır: satıştan sonraki 45 gün adaptasyon, bakım aralığı ve garanti bitişi.
              </small>
            </div>
          </section>

          <p className="device-muted">Cihazı değiştirirseniz adaptasyon tarihini yeni cihaza göre girin veya boş bırakın.</p>
          {error && <p className="ui-error" role="alert">{error}</p>}
        </form>
      )}

      {mode.kind === "replace" && (
        <DeviceReplaceForm
          patient={patient}
          device={mode.device}
          catalog={catalog}
          today={today}
          run={run}
          onBack={() => setMode({ kind: "main" })}
          onDone={() => finished("Cihaz değişimi kaydedildi.")}
        />
      )}
      {mode.kind === "legacy" && (
        <LegacyDeviceForm
          patient={patient}
          catalog={catalog}
          today={today}
          run={run}
          onBack={() => setMode({ kind: "main" })}
          onDone={() => finished("Geçmiş cihaz eklendi.")}
        />
      )}
      {!main && error && <p className="ui-error" role="alert">{error}</p>}
      {stepUpDialog}
    </Modal>
  );
}
