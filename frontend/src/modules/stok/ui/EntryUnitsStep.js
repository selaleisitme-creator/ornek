"use client";

import { useState } from "react";
import MoneyInput from "@/modules/shared/ui/MoneyInput";
import ScanInput from "@/modules/shared/ui/ScanInput";
import { formatMoney } from "@/lib/money";
import {
  EAR_SIDE_OPTIONS,
  MAX_ENTRY_UNITS,
  hasEarSides,
  packsFromPackaging,
  sameGtin,
  serialPolicyLabel,
  splitTotalCost,
} from "../stockRules";
import { addSupplier } from "../server/actions";
import PickOrAdd from "./PickOrAdd";

let rowSeed = 0;
// Each unit row gets its own key, so deleting or reordering never moves typed text to another row.
export function emptyRow() {
  rowSeed += 1;
  return { key: rowSeed, serialNo: "", earSide: "", productionDate: "" };
}

// The rows to send. A serial-less model has no rows to tell apart: its units are the count, all with the
// same side and production date.
export function entryUnits(entry, serialPolicy) {
  if (serialPolicy === "none") {
    return Array.from({ length: entry.count }, () => ({ serialNo: "", earSide: entry.commonSide, productionDate: entry.commonDate }));
  }
  return entry.rows;
}

function resizeRows(rows, count) {
  if (rows.length >= count) return rows.slice(0, count);
  return [...rows, ...Array.from({ length: count - rows.length }, emptyRow)];
}

function clampCount(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) return 1;
  return Math.min(number, MAX_ENTRY_UNITS);
}

// "7 × 4.285,71 TL · son birim 4.285,74 TL" for a total, "Toplam: 3 × 1.000,00 = 3.000,00 TL" for a unit price.
function pricePreview(entry, count) {
  if (!(entry.amount > 0) || count < 1) return null;
  if (entry.priceMode === "unit") {
    const totalKurus = Math.round(entry.amount * 100) * count;
    return `Toplam: ${count} × ${formatMoney(entry.amount)} = ${formatMoney(totalKurus / 100)}`;
  }
  const prices = splitTotalCost(entry.amount, count);
  const base = prices[0];
  const last = prices[prices.length - 1];
  if (count === 1 || base === last) return `${count} × ${formatMoney(base)}`;
  return `${count - 1} × ${formatMoney(base)} · son birim ${formatMoney(last)} (kuruş farkı son birime eklenir)`;
}

function PackCalculator({ model, onApply }) {
  const [values, setValues] = useState({ cartons: "", boxes: "", packs: "" });
  const packs = packsFromPackaging(values, model);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <details className="stock-entry-pack">
      <summary>Koli / kutu ile hesapla</summary>
      <div className="stock-entry-inline">
        <label className="ui-field"><span className="ui-label">Koli</span><input className="ui-input" type="number" min={0} value={values.cartons} onChange={set("cartons")} /></label>
        <label className="ui-field"><span className="ui-label">Kutu</span><input className="ui-input" type="number" min={0} value={values.boxes} onChange={set("boxes")} /></label>
        <label className="ui-field"><span className="ui-label">Paket</span><input className="ui-input" type="number" min={0} value={values.packs} onChange={set("packs")} /></label>
        <button type="button" className="ui-button ui-button-ghost" disabled={!packs} onClick={() => onApply(packs)}>
          {packs ? `${packs} paket yaz` : "Paket sayısı"}
        </button>
      </div>
      {packs === null && <span className="ui-error">Bu modelde kutudaki paket / kolideki kutu sayısı kayıtlı değil.</span>}
    </details>
  );
}

// Step 3: how many units, their serial numbers, and the purchase.
//   model: { name, gtin, serialPolicy, packsPerBox, boxesPerCarton, isNew, category }
export default function EntryUnitsStep({ model, entry, setEntry, today, paymentMethods, suppliers, onSupplierAdded, onGtinScanned }) {
  const [scanNote, setScanNote] = useState(null); // { tone: "warn" | "info", text }
  const policy = model.serialPolicy;
  const sided = hasEarSides(model.category);
  const count = policy === "none" ? entry.count : entry.rows.length;
  const set = (key) => (value) => setEntry((current) => ({ ...current, [key]: value }));

  function setCount(value) {
    const next = clampCount(value);
    setEntry((current) => ({ ...current, count: next, rows: resizeRows(current.rows, next) }));
  }

  function setMode(mode) {
    // Back to "Tekli" keeps only the first row; going to "Toplu" keeps what was typed.
    setEntry((current) => (mode === "single" ? { ...current, mode, count: 1, rows: current.rows.slice(0, 1) } : { ...current, mode }));
  }

  function updateRow(index, key, value) {
    setEntry((current) => ({
      ...current,
      rows: current.rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    }));
  }

  // Each scan fills the next empty serial. A GS1 label also checks the product: a different GTIN means a
  // box of another model, so it is refused instead of being stocked under the wrong name.
  function handleScan(scan) {
    setScanNote(null);
    let serial = scan.raw?.trim() ?? "";
    if (scan.gtin) {
      if (model.gtin && !sameGtin(model.gtin, scan.gtin)) {
        setScanNote({ tone: "warn", text: `Okutulan GTIN (${scan.gtin}) bu modelin GTIN'iyle (${model.gtin}) uyuşmuyor; eklenmedi.` });
        return;
      }
      if (!model.gtin && model.isNew) {
        onGtinScanned(scan.gtin);
        setScanNote({ tone: "info", text: `GTIN ${scan.gtin} yeni modele yazıldı.` });
      } else if (!model.gtin) {
        setScanNote({ tone: "info", text: "Bu modelin GTIN'i kayıtlı değil; model düzenlenirken eklenebilir." });
      }
      serial = scan.serial ?? "";
      if (!serial) {
        setScanNote({ tone: "warn", text: "Etikette seri numarası yok." });
        return;
      }
    }
    if (!serial) return;
    if (entry.rows.some((row) => row.serialNo.trim() === serial)) {
      setScanNote({ tone: "warn", text: `${serial} zaten listede.` });
      return;
    }

    setEntry((current) => {
      let rows = current.rows;
      let index = rows.findIndex((row) => !row.serialNo.trim());
      if (index === -1) {
        if (rows.length >= MAX_ENTRY_UNITS) return current;
        rows = [...rows, emptyRow()];
        index = rows.length - 1;
      }
      rows = rows.map((row, i) =>
        i === index ? { ...row, serialNo: serial, productionDate: row.productionDate || scan.productionDate || "" } : row
      );
      // A second scan in "Tekli" means more than one unit is arriving.
      return { ...current, rows, count: rows.length, mode: rows.length > 1 ? "bulk" : current.mode };
    });
  }

  const preview = pricePreview(entry, count);

  return (
    <div className="ui-stack">
      <p className="stock-entry-summary">
        <strong>{model.name}</strong>
        <span className="stock-muted"> · Seri no: {serialPolicyLabel(policy)}{model.gtin ? ` · GTIN ${model.gtin}` : ""}</span>
      </p>

      <fieldset className="stock-entry-choices">
        <legend className="ui-label">Giriş türü</legend>
        {[
          { value: "single", label: "Tekli giriş" },
          { value: "bulk", label: "Toplu giriş" },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            className={`stock-entry-choice${entry.mode === option.value ? " on" : ""}`}
            aria-pressed={entry.mode === option.value}
            onClick={() => setMode(option.value)}
          >
            {option.label}
          </button>
        ))}
      </fieldset>

      {entry.mode === "bulk" && (
        <div className="stock-entry-inline">
          <label className="ui-field" htmlFor="entry-count">
            <span className="ui-label">Stok adedi{model.category === "battery" ? " (paket)" : ""}</span>
            <input id="entry-count" className="ui-input stock-entry-count" type="number" min={1} max={MAX_ENTRY_UNITS} value={count} onChange={(event) => setCount(event.target.value)} />
          </label>
          {model.category === "battery" && <PackCalculator model={model} onApply={setCount} />}
        </div>
      )}

      {policy === "none" ? (
        <div className="stock-entry-grid">
          {sided && (
            <label className="ui-field" htmlFor="entry-common-side">
              <span className="ui-label">Taraf</span>
              <select id="entry-common-side" className="ui-input" value={entry.commonSide} onChange={(event) => set("commonSide")(event.target.value)}>
                {EAR_SIDE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          )}
          <label className="ui-field" htmlFor="entry-common-date">
            <span className="ui-label">ÜRT tarihi (isteğe bağlı)</span>
            <input id="entry-common-date" className="ui-input" type="date" max={today} value={entry.commonDate} onChange={(event) => set("commonDate")(event.target.value)} />
          </label>
          <p className="stock-entry-hint stock-entry-wide">Bu model seri numarasız takip edilir; birimler adet olarak eklenir.</p>
        </div>
      ) : (
        <div className="ui-stack">
          <ScanInput label="Seri no okut" placeholder="Etiketi okutun; her okutma bir sonraki boş satırı doldurur" onScan={handleScan} />
          {scanNote && (
            <p className={`stock-entry-note ${scanNote.tone}`} role={scanNote.tone === "warn" ? "alert" : "status"}>{scanNote.text}</p>
          )}
          <ol className="stock-entry-rows">
            {entry.rows.map((row, index) => (
              <li key={row.key} className="stock-entry-row">
                <span className="stock-entry-row-no" aria-hidden="true">{index + 1}</span>
                <label className="ui-field">
                  <span className="ui-label">Seri no{policy === "optional" ? " (isteğe bağlı)" : ""}</span>
                  <input className="ui-input" value={row.serialNo} maxLength={60} autoComplete="off" spellCheck={false} onChange={(event) => updateRow(index, "serialNo", event.target.value)} />
                </label>
                {sided && (
                  <label className="ui-field">
                    <span className="ui-label">Taraf</span>
                    <select className="ui-input" value={row.earSide} onChange={(event) => updateRow(index, "earSide", event.target.value)}>
                      {EAR_SIDE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                )}
                <label className="ui-field">
                  <span className="ui-label">ÜRT tarihi</span>
                  <input className="ui-input" type="date" max={today} value={row.productionDate} onChange={(event) => updateRow(index, "productionDate", event.target.value)} />
                </label>
              </li>
            ))}
          </ol>
        </div>
      )}

      <section className="stock-entry-purchase ui-stack" aria-label="Alış">
        <label className="stock-entry-check">
          <input type="checkbox" checked={entry.opening} onChange={(event) => set("opening")(event.target.checked)} />
          <span>
            <strong>Açılış stoğu</strong>
            <span className="stock-entry-hint"> Panelden önce alınmış ürün; kasa defterine gider yazılmaz.</span>
          </span>
        </label>

        <fieldset className="stock-entry-choices">
          <legend className="ui-label">Alış fiyatı</legend>
          {[
            { value: "unit", label: "Birim alış fiyatı" },
            { value: "total", label: "Toplam alış tutarı" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className={`stock-entry-choice${entry.priceMode === option.value ? " on" : ""}`}
              aria-pressed={entry.priceMode === option.value}
              onClick={() => set("priceMode")(option.value)}
            >
              {option.label}
            </button>
          ))}
        </fieldset>

        <div className="stock-entry-grid">
          <div className="ui-field">
            <MoneyInput
              id="entry-amount"
              label={`${entry.priceMode === "unit" ? "Birim alış fiyatı" : "Toplam alış tutarı"}${entry.opening ? " (isteğe bağlı)" : ""}`}
              defaultValue={entry.amount}
              onChange={set("amount")}
              required={!entry.opening}
            />
            {preview && <span className="stock-entry-hint">{preview}</span>}
          </div>

          {!entry.opening && (
            <>
              <label className="ui-field" htmlFor="entry-payment">
                <span className="ui-label">Alış ödeme şekli</span>
                <select id="entry-payment" className="ui-input" value={entry.paymentMethod} required onChange={(event) => set("paymentMethod")(event.target.value)}>
                  <option value="">Seçin…</option>
                  {paymentMethods.map((method) => <option key={method.code} value={method.code}>{method.name}</option>)}
                </select>
              </label>
              <PickOrAdd
                id="entry-supplier"
                label="Tedarikçi (isteğe bağlı)"
                options={suppliers}
                value={entry.supplierId}
                onChange={set("supplierId")}
                onAdd={(name) => addSupplier({ name })}
                onAdded={onSupplierAdded}
                addLabel="Yeni tedarikçi"
                placeholder="Tedarikçi adı"
              />
              <label className="ui-field" htmlFor="entry-invoice">
                <span className="ui-label">Fatura no (isteğe bağlı)</span>
                <input id="entry-invoice" className="ui-input" value={entry.invoiceNo} maxLength={60} onChange={(event) => set("invoiceNo")(event.target.value)} />
              </label>
              <label className="ui-field" htmlFor="entry-date">
                <span className="ui-label">Giriş tarihi</span>
                <input id="entry-date" className="ui-input" type="date" max={today} required value={entry.receivedOn} onChange={(event) => set("receivedOn")(event.target.value)} />
              </label>
              <label className="ui-field stock-entry-wide" htmlFor="entry-note">
                <span className="ui-label">Not (isteğe bağlı)</span>
                <textarea id="entry-note" className="ui-input" rows={2} maxLength={500} value={entry.note} onChange={(event) => set("note")(event.target.value)} />
              </label>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
