"use client";

import { useMemo, useState } from "react";
import MoneyInput from "@/modules/shared/ui/MoneyInput";
import { DEVICE_EAR_SIDES, buildLegacyArgs } from "../deviceRules";
import { addLegacyDevice } from "../server/actions";

const NEW_MODEL = "new";

// "Geçmiş cihaz ekle": a device the patient bought before the panel existed. It is saved as a legacy sale, so it takes no
// payment and never reaches the reports, receivables or the cash ledger. A model that is not in the list is created as
// not for sale (inactive). Saving asks for the 6-digit code (run = useStepUpAction).
//   catalog: { brands, models } with inactive models included
export default function LegacyDeviceForm({ patient, catalog, today, run, onBack, onDone }) {
  const [brandId, setBrandId] = useState("");
  const [modelChoice, setModelChoice] = useState("");
  const [modelName, setModelName] = useState("");
  const [modelType, setModelType] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [earSide, setEarSide] = useState("");
  const [saleDate, setSaleDate] = useState("");
  const [warrantyEnd, setWarrantyEnd] = useState("");
  const [unitPrice, setUnitPrice] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const models = useMemo(
    () => (catalog?.models ?? []).filter((model) => String(model.brandId) === String(brandId)),
    [catalog, brandId]
  );
  const creating = modelChoice === NEW_MODEL;

  async function save(event) {
    event.preventDefault();
    const input = {
      productId: creating ? null : modelChoice,
      brandId,
      modelName: creating ? modelName : null,
      modelType: creating ? modelType : null,
      serialNo,
      earSide,
      saleDate,
      warrantyEnd,
      unitPrice,
    };
    const check = buildLegacyArgs(input, { today });
    if (check.error) return setError(check.error);
    setBusy(true);
    setError(null);
    const result = await run(addLegacyDevice, patient.id, input);
    setBusy(false);
    if (result?.ok) return onDone();
    if (!result?.cancelled) setError(result?.error ?? "Geçmiş cihaz eklenemedi.");
  }

  return (
    <form className="device-form" onSubmit={save} noValidate>
      <p className="device-note">
        Panelden önce satılmış cihaz. Ödeme almaz; raporlara, alacaklara ve kasa defterine girmez. Hasta kartında ve takiplerde görünür.
      </p>

      <div className="device-grid">
        <label className="ui-field" htmlFor="legacy-brand">
          <span className="ui-label">Marka</span>
          <select
            id="legacy-brand"
            className="ui-input"
            value={brandId}
            onChange={(event) => {
              setBrandId(event.target.value);
              setModelChoice("");
            }}
          >
            <option value="">Marka seçin</option>
            {(catalog?.brands ?? []).map((brand) => (
              <option key={brand.id} value={brand.id}>{brand.name}</option>
            ))}
          </select>
        </label>
        <label className="ui-field" htmlFor="legacy-model">
          <span className="ui-label">Model</span>
          <select id="legacy-model" className="ui-input" value={modelChoice} onChange={(event) => setModelChoice(event.target.value)} disabled={!brandId}>
            <option value="">Model seçin</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}{model.active ? "" : " (satışta değil)"}
              </option>
            ))}
            <option value={NEW_MODEL}>＋ Listede yok, yeni model</option>
          </select>
        </label>
        {creating && (
          <>
            <label className="ui-field" htmlFor="legacy-model-name">
              <span className="ui-label">Yeni model adı</span>
              <input id="legacy-model-name" className="ui-input" maxLength={120} value={modelName} onChange={(event) => setModelName(event.target.value)} />
            </label>
            <label className="ui-field" htmlFor="legacy-model-type">
              <span className="ui-label">Tip / varyant (isteğe bağlı)</span>
              <input id="legacy-model-type" className="ui-input" maxLength={120} value={modelType} onChange={(event) => setModelType(event.target.value)} />
            </label>
          </>
        )}
        <label className="ui-field" htmlFor="legacy-serial">
          <span className="ui-label">Seri numarası</span>
          <input
            id="legacy-serial"
            className="ui-input"
            autoComplete="off"
            maxLength={200}
            value={serialNo}
            onChange={(event) => setSerialNo(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
          />
        </label>
        <label className="ui-field" htmlFor="legacy-side">
          <span className="ui-label">Kulak</span>
          <select id="legacy-side" className="ui-input" value={earSide} onChange={(event) => setEarSide(event.target.value)}>
            <option value="">Taraf seçin</option>
            {DEVICE_EAR_SIDES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="ui-field" htmlFor="legacy-date">
          <span className="ui-label">Satış tarihi</span>
          <input id="legacy-date" className="ui-input" type="date" max={today} value={saleDate} onChange={(event) => setSaleDate(event.target.value)} />
        </label>
        <label className="ui-field" htmlFor="legacy-warranty">
          <span className="ui-label">Garanti bitişi (isteğe bağlı)</span>
          <input id="legacy-warranty" className="ui-input" type="date" min={saleDate || undefined} value={warrantyEnd} onChange={(event) => setWarrantyEnd(event.target.value)} />
        </label>
        <MoneyInput id="legacy-price" label="Satış tutarı (isteğe bağlı, bilgi için)" defaultValue={null} onChange={setUnitPrice} />
      </div>

      {error && <p className="ui-error" role="alert">{error}</p>}
      <p className="device-muted">Kaydetmek için 6 haneli kodunuz istenir.</p>
      <div className="device-form-actions">
        <button type="button" className="ui-button ui-button-ghost" onClick={onBack} disabled={busy}>← Geri</button>
        <button type="submit" className="ui-button ui-button-primary" disabled={busy}>
          {busy ? "Bekleyin…" : "Geçmiş cihazı kaydet"}
        </button>
      </div>
    </form>
  );
}
