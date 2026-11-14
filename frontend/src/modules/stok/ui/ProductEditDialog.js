"use client";

import { useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import ConfirmDialog from "@/modules/shared/ui/ConfirmDialog";
import MoneyInput from "@/modules/shared/ui/MoneyInput";
import { useToast } from "@/modules/shared/ui/Toast";
import { useStepUpAction } from "@/modules/shared/ui/useStepUpAction";
import { SERIAL_POLICIES, modelFieldsError, serialRuleWarning } from "../stockRules";
import { deactivateModel, updateModel } from "../server/actions";
import PhotoManager from "./PhotoManager";

function TextField({ id, label, value, onChange, ...rest }) {
  return (
    <label className="ui-field" htmlFor={id}>
      <span className="ui-label">{label}</span>
      <input id={id} className="ui-input" value={value ?? ""} onChange={(event) => onChange(event.target.value)} {...rest} />
    </label>
  );
}

// The editable copy starts from the server's values; only the fields this window may change are kept.
function draftFrom(details) {
  const { name, type, salePrice, gtin, packageBarcode, manufacturerRef, warrantyMonths, minStock, serialPolicy, packSize, packsPerBox, boxesPerCarton } = details;
  return { name, type, salePrice, gtin, packageBarcode, manufacturerRef, warrantyMonths, minStock, serialPolicy, packSize, packsPerBox, boxesPerCarton };
}

// "Model düzenle": the new-model fields (brand and group stay fixed), the photos, and "Modeli pasifleştir".
//   details:         the open model's fields and photos (stockService.loadOpenDetails)
//   inStock:         shelf count; a model with stock cannot be deactivated
//   serialLessCount: shelf units without a serial, for the warning when the rule becomes "Zorunlu"
export default function ProductEditDialog({ details, brandName, inStock, serialLessCount, onClose }) {
  const toast = useToast();
  const { run, stepUpDialog } = useStepUpAction();
  const [draft, setDraft] = useState(() => draftFrom(details));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const set = (key) => (value) => setDraft((current) => ({ ...current, [key]: value }));
  const battery = details.category === "battery";
  const warning = serialRuleWarning({ from: details.serialPolicy, to: draft.serialPolicy, serialLessCount });

  async function save() {
    const problem = modelFieldsError({ ...draft, category: details.category });
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const result = await updateModel(details.productId, draft);
      if (!result?.ok) return setError(result?.error ?? "Model kaydedilemedi.");
      toast("Model güncellendi.");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    setError(null);
    try {
      const result = await run(deactivateModel, details.productId);
      setConfirming(false);
      if (result?.ok) {
        toast("Model pasifleştirildi.");
        onClose();
      } else if (!result?.cancelled) {
        setError(result?.error ?? "Model pasifleştirilemedi.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={`Stok · ${brandName}`}
      title="Model düzenle"
      size="lg"
      footer={
        <>
          {error && <p className="ui-error stock-entry-error" role="alert">{error}</p>}
          <button type="button" className="ui-button ui-button-ghost" onClick={onClose} disabled={busy}>Vazgeç</button>
          <button type="button" className="ui-button ui-button-primary" onClick={save} disabled={busy}>
            {busy ? "Bekleyin…" : "Kaydet"}
          </button>
        </>
      }
    >
      <div className="ui-stack">
        <div className="stock-entry-grid">
          <TextField id="edit-name" label="Model adı" value={draft.name} onChange={set("name")} maxLength={120} required />
          <TextField id="edit-type" label="Tip / varyant (isteğe bağlı)" value={draft.type} onChange={set("type")} maxLength={120} />
          <MoneyInput id="edit-sale-price" label="Satış fiyatı" defaultValue={draft.salePrice} onChange={set("salePrice")} required />
          <TextField id="edit-gtin" label="GTIN (isteğe bağlı)" value={draft.gtin} onChange={set("gtin")} inputMode="numeric" maxLength={20} />
          <TextField id="edit-package" label="Ambalaj barkodu (isteğe bağlı)" value={draft.packageBarcode} onChange={set("packageBarcode")} maxLength={60} />
          <TextField id="edit-ref" label="Üretici REF (isteğe bağlı)" value={draft.manufacturerRef} onChange={set("manufacturerRef")} maxLength={60} />
          <TextField id="edit-warranty" label="Garanti (ay)" type="number" min={0} step={1} value={draft.warrantyMonths} onChange={set("warrantyMonths")} />
          <TextField id="edit-min-stock" label="Alt stok eşiği" type="number" min={0} step={1} value={draft.minStock} onChange={set("minStock")} />
          <label className="ui-field" htmlFor="edit-serial-policy">
            <span className="ui-label">Seri numarası</span>
            <select id="edit-serial-policy" className="ui-input" value={draft.serialPolicy} onChange={(event) => set("serialPolicy")(event.target.value)}>
              {SERIAL_POLICIES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {battery && (
            <>
              <TextField id="edit-pack-size" label="Paket içi pil adedi" type="number" min={1} step={1} value={draft.packSize} onChange={set("packSize")} required />
              <TextField id="edit-packs-per-box" label="Kutudaki paket (isteğe bağlı)" type="number" min={1} step={1} value={draft.packsPerBox} onChange={set("packsPerBox")} />
              <TextField id="edit-boxes-per-carton" label="Kolideki kutu (isteğe bağlı)" type="number" min={1} step={1} value={draft.boxesPerCarton} onChange={set("boxesPerCarton")} />
            </>
          )}
        </div>
        {warning && <p className="stock-entry-note warn" role="status">{warning}</p>}
        <p className="stock-entry-hint">Satış fiyatı değişirse eski ve yeni fiyat geçmişe kendiliğinden yazılır.</p>

        <PhotoManager productId={details.productId} photos={details.photos} />

        <section className="stock-danger-zone" aria-labelledby="edit-deactivate-title">
          <h3 id="edit-deactivate-title">Modeli pasifleştir</h3>
          <p className="stock-muted">
            {inStock > 0
              ? `Stokta ${inStock} birim var. Model ancak stokta birimi yokken pasifleştirilebilir.`
              : "Model listeden kalkar; geçmiş satışlar ve kayıtlar silinmez."}
          </p>
          <button type="button" className="ui-button ui-button-danger" disabled={busy || inStock > 0} onClick={() => setConfirming(true)}>
            Modeli pasifleştir
          </button>
        </section>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Modeli pasifleştir"
        message={`${brandName} ${details.name} listeden kalkacak. Devam etmek için 6 haneli kodunuz istenebilir.`}
        confirmLabel="Pasifleştir"
        danger
        busy={busy}
        onConfirm={deactivate}
        onCancel={() => setConfirming(false)}
      />
      {stepUpDialog}
    </Modal>
  );
}
