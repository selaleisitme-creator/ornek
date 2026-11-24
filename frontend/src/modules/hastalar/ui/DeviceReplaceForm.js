"use client";

import { useMemo, useState } from "react";
import { REPLACEMENT_REASONS, buildReplaceArgs, serialFromScan } from "../deviceRules";
import { findReplacementUnit, replaceDevice } from "../server/actions";

// "Cihazı değiştir": the new device's serial is scanned or typed. A unit on the shelf is used as it is; a serial the
// system does not know is a unit the manufacturer sent, so its model is asked and it is registered with the swap
// (no money changes hands, nothing reaches the cash ledger). Saving asks for the 6-digit code (run = useStepUpAction).
//   device: the current device being replaced (currentDevices row); catalog: { brands, models }
export default function DeviceReplaceForm({ patient, device, catalog, today, run, onBack, onDone }) {
  const [serialText, setSerialText] = useState("");
  const [lookup, setLookup] = useState(null); // null | { found, serial, unit? }
  const [productId, setProductId] = useState("");
  const [reason, setReason] = useState("warranty");
  const [replacedOn, setReplacedOn] = useState(today);
  const [warrantyEnd, setWarrantyEnd] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Models of the old device's brand first, then the rest; only models still sold.
  const models = useMemo(() => {
    const active = (catalog?.models ?? []).filter((model) => model.active);
    const brandName = new Map((catalog?.brands ?? []).map((brand) => [brand.id, brand.name]));
    const label = (model) => `${brandName.get(model.brandId) ?? ""} ${model.name}`.trim();
    return active
      .map((model) => ({ ...model, label: label(model), same: model.brandId === device.brandId }))
      .sort((a, b) => Number(b.same) - Number(a.same) || a.label.localeCompare(b.label, "tr"));
  }, [catalog, device.brandId]);

  async function checkSerial() {
    const serial = serialFromScan(serialText);
    setLookup(null);
    setError(null);
    if (!serial) return;
    setSerialText(serial);
    const result = await findReplacementUnit(serial);
    if (!result?.ok) return setError(result?.error ?? "Seri numarası kontrol edilemedi.");
    setLookup(result.data);
  }

  function serialKey(event) {
    if (event.key !== "Enter") return;
    event.preventDefault(); // a scanner ends with Enter; it must not submit the form
    checkSerial();
  }

  async function save(event) {
    event.preventDefault();
    if (!lookup) return setError("Önce yeni cihazın seri numarasını okutun ya da yazıp Enter'a basın.");
    const input = {
      saleItemId: device.saleItemId,
      unitId: lookup.found ? lookup.unit.id : null,
      productId: lookup.found ? null : productId,
      serialNo: lookup.found ? null : lookup.serial,
      reason,
      replacedOn,
      note,
      warrantyEnd,
    };
    const check = buildReplaceArgs(input, { device, today });
    if (check.error) return setError(check.error);
    setBusy(true);
    setError(null);
    const result = await run(replaceDevice, patient.id, input);
    setBusy(false);
    if (result?.ok) return onDone();
    if (!result?.cancelled) setError(result?.error ?? "Cihaz değişimi kaydedilemedi.");
  }

  return (
    <form className="device-form" onSubmit={save} noValidate>
      <div className="device-row">
        <div>
          <b>Değişecek cihaz: {device.name ?? "Cihaz"}</b>
          <small>{device.serial ? `Seri: ${device.serial}` : "Seri numarası yok"}</small>
        </div>
      </div>

      <label className="ui-field" htmlFor="replace-serial">
        <span className="ui-label">Yeni cihazın seri numarası</span>
        <input
          id="replace-serial"
          className="ui-input"
          autoComplete="off"
          placeholder="Etiketi okutun ya da seri numarasını yazıp Enter'a basın"
          value={serialText}
          onChange={(event) => {
            setSerialText(event.target.value);
            setLookup(null);
          }}
          onKeyDown={serialKey}
          onBlur={checkSerial}
        />
      </label>
      {lookup?.found && <p className="device-found ok">Stokta bulundu: {lookup.unit.name} · {lookup.serial}</p>}
      {lookup && !lookup.found && (
        <>
          <p className="device-found new">
            {lookup.serial} stokta kayıtlı değil. Üreticiden gelen cihazsa modelini seçin; stoğa açılış olarak kaydedilip hastaya verilir
            (kasa defterine girmez).
          </p>
          <label className="ui-field" htmlFor="replace-model">
            <span className="ui-label">Yeni cihazın modeli</span>
            <select id="replace-model" className="ui-input" value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">Model seçin</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
          </label>
        </>
      )}

      <fieldset className="device-radios">
        <legend>Değişim nedeni</legend>
        {REPLACEMENT_REASONS.map((option) => (
          <label key={option.value}>
            <input type="radio" name="replace-reason" value={option.value} checked={reason === option.value} onChange={() => setReason(option.value)} />
            {option.label}
          </label>
        ))}
      </fieldset>

      <div className="device-grid">
        <label className="ui-field" htmlFor="replace-date">
          <span className="ui-label">Değişim tarihi</span>
          <input id="replace-date" className="ui-input" type="date" max={today} min={device.saleDate ?? undefined} value={replacedOn} onChange={(event) => setReplacedOn(event.target.value)} />
        </label>
        <label className="ui-field" htmlFor="replace-warranty">
          <span className="ui-label">Yeni garanti bitişi (isteğe bağlı)</span>
          <input id="replace-warranty" className="ui-input" type="date" min={device.warrantyStart ?? undefined} value={warrantyEnd} onChange={(event) => setWarrantyEnd(event.target.value)} />
        </label>
      </div>

      <label className="ui-field" htmlFor="replace-note">
        <span className="ui-label">Not (isteğe bağlı)</span>
        <input id="replace-note" className="ui-input" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>

      {error && <p className="ui-error" role="alert">{error}</p>}
      <p className="device-muted">Eski cihaz kayıtta kalır ve değişim geçmişinde görünür. Kaydetmek için 6 haneli kodunuz istenir.</p>
      <div className="device-form-actions">
        <button type="button" className="ui-button ui-button-ghost" onClick={onBack} disabled={busy}>← Geri</button>
        <button type="submit" className="ui-button ui-button-primary" disabled={busy}>
          {busy ? "Bekleyin…" : "Değişimi kaydet"}
        </button>
      </div>
    </form>
  );
}
