"use client";

import { useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import MoneyInput from "@/modules/shared/ui/MoneyInput";
import { useToast } from "@/modules/shared/ui/Toast";
import { useStepUpAction } from "@/modules/shared/ui/useStepUpAction";
import { usePanelSession } from "@/modules/shared/ui/panelSessionStore";
import { todayInClinic } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { EAR_SIDE_OPTIONS, buildUnitUpdate, hasEarSides, purchasePriceError } from "../stockRules";
import { correctUnitPurchasePrice, updateUnit } from "../server/actions";

// "Birim düzenle" for one row of the open model's unit table.
// A collapsed serial-less row ("8 adet") is edited as a whole: side and production date apply to all its
// units; serial and WSA code belong to a single unit, so they are not offered there.
// The purchase price part is shown to admins only; the server and the database refuse everyone else anyway.
export default function UnitEditDialog({ unit, model, onClose }) {
  const toast = useToast();
  const session = usePanelSession();
  const { run, stepUpDialog } = useStepUpAction();
  const [today] = useState(() => todayInClinic());
  const collapsed = unit.unitIds.length > 1;
  // A unit that got its serial before the rule became "Kullanılmıyor" still shows it, so it can be cleared.
  const showSerial = !collapsed && (model.serialPolicy !== "none" || Boolean(unit.serialNo));
  const sided = hasEarSides(model.category);

  const [values, setValues] = useState({
    serialNo: unit.serialNo ?? "",
    earSide: unit.earSide ?? "",
    productionDate: unit.productionDate ?? "",
    wsaCode: unit.wsaCode ?? "",
  });
  const [price, setPrice] = useState(unit.purchasePrice === null || unit.purchasePrice === undefined ? null : Number(unit.purchasePrice));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [priceError, setPriceError] = useState(null);

  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  async function save() {
    const built = buildUnitUpdate(values, { category: model.category, serialPolicy: model.serialPolicy, collapsed, today });
    if (built.error) return setError(built.error);
    setBusy(true);
    setError(null);
    try {
      const result = await updateUnit({ unitIds: unit.unitIds, ...values });
      if (!result?.ok) return setError(result?.error ?? "Birim kaydedilemedi.");
      toast(collapsed ? `${unit.unitIds.length} birim güncellendi.` : "Birim güncellendi.");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function savePrice() {
    const problem = purchasePriceError(price);
    if (problem) return setPriceError(problem);
    setBusy(true);
    setPriceError(null);
    try {
      const result = await run(correctUnitPurchasePrice, { unitIds: unit.unitIds, amount: price });
      if (result?.ok) {
        toast("Alış fiyatı düzeltildi.");
        onClose();
      } else if (!result?.cancelled) {
        setPriceError(result?.error ?? "Alış fiyatı düzeltilemedi.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={`Stok · ${model.brandName} ${model.name}`}
      title="Birim düzenle"
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
        {collapsed && (
          <p className="stock-entry-note info">
            Bu satırda seri numarasız {unit.unitIds.length} birim var. Taraf ve üretim tarihi hepsine birlikte yazılır.
          </p>
        )}
        <div className="stock-entry-grid">
          {showSerial && (
            <label className="ui-field" htmlFor="unit-serial">
              <span className="ui-label">{model.serialPolicy === "required" ? "Seri no" : "Seri no (isteğe bağlı)"}</span>
              <input id="unit-serial" className="ui-input" value={values.serialNo} onChange={set("serialNo")} maxLength={60} autoComplete="off" spellCheck={false} />
            </label>
          )}
          {sided && (
            <label className="ui-field" htmlFor="unit-side">
              <span className="ui-label">Taraf</span>
              <select id="unit-side" className="ui-input" value={values.earSide} onChange={set("earSide")}>
                {EAR_SIDE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          )}
          <label className="ui-field" htmlFor="unit-production">
            <span className="ui-label">ÜRT tarihi</span>
            <input id="unit-production" className="ui-input" type="date" max={today} value={values.productionDate} onChange={set("productionDate")} />
          </label>
          {!collapsed && (
            <label className="ui-field" htmlFor="unit-wsa">
              <span className="ui-label">WSA kodu</span>
              <input id="unit-wsa" className="ui-input" value={values.wsaCode} onChange={set("wsaCode")} maxLength={60} autoComplete="off" />
            </label>
          )}
        </div>

        {session.isAdmin && (
          <section className="stock-danger-zone" aria-labelledby="unit-price-title">
            <h3 id="unit-price-title">Alış fiyatını düzelt</h3>
            <p className="stock-muted">
              Şu an {formatMoney(unit.purchasePrice)}
              {collapsed ? ` (${unit.unitIds.length} birimin her biri)` : ""}. Kasa defterindeki alış gideri de değişir;
              eski ve yeni fiyat kaydedilir. 6 haneli kodunuz istenir.
            </p>
            <div className="stock-entry-inline">
              <MoneyInput id="unit-purchase-price" label="Yeni alış fiyatı (birim)" defaultValue={price} onChange={setPrice} />
              <button type="button" className="ui-button ui-button-ghost" onClick={savePrice} disabled={busy}>
                Alış fiyatını kaydet
              </button>
            </div>
            {priceError && <p className="ui-error" role="alert">{priceError}</p>}
          </section>
        )}
      </div>
      {stepUpDialog}
    </Modal>
  );
}
