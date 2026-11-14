"use client";

import { useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import ScanInput from "@/modules/shared/ui/ScanInput";
import { useToast } from "@/modules/shared/ui/Toast";
import { useStepUpAction } from "@/modules/shared/ui/useStepUpAction";
import { formatDate } from "@/lib/dates";
import { REMOVAL_REASONS, buildRemovalArgs, earSideLabel, pickedUnitIds, receiptLabel, rowBySerial } from "../stockRules";
import { removeStockUnits } from "../server/actions";

function rowTitle(row) {
  return row.serialNo ?? `Seri numarasız · ${row.count} adet`;
}

function rowDetails(row) {
  return [earSideLabel(row.earSide), `Giriş ${formatDate(row.receivedOn)}`, receiptLabel(row)].join(" · ");
}

// "Stok sil" for the open model: tick units (or scan their serial), pick a reason, then the 6-digit code.
// Units are not deleted: they become "removed" and the reason is kept (remove_stock_units, 010).
//   units: the open model's rows from collapseUnits, each with the ids of all its units.
export default function StockRemoveDialog({ model, units, onClose }) {
  const toast = useToast();
  const { run, stepUpDialog } = useStepUpAction();
  const [counts, setCounts] = useState({}); // { [rowId]: how many of that row }
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [scanNote, setScanNote] = useState(null);

  const unitIds = pickedUnitIds(units, counts);
  const setCount = (row, value) => setCounts((current) => ({ ...current, [row.id]: value }));

  function toggle(row, checked) {
    setCount(row, checked ? row.count : 0);
  }

  function scanned(scan) {
    const serial = scan.serial ?? scan.raw;
    const row = rowBySerial(units, serial);
    if (!row) {
      setScanNote({ tone: "warn", text: `${serial || "Okutulan kod"} bu modelin stoğunda yok.` });
      return;
    }
    setCount(row, 1);
    setScanNote({ tone: "info", text: `${row.serialNo} işaretlendi.` });
  }

  async function remove() {
    const built = buildRemovalArgs({ unitIds, reason, note });
    if (built.error) return setError(built.error);
    setBusy(true);
    setError(null);
    try {
      const result = await run(removeStockUnits, built.args);
      if (result?.ok) {
        toast(`${result.data?.count ?? unitIds.length} birim stoktan silindi.`);
        onClose();
      } else if (!result?.cancelled) {
        setError(result?.error ?? "Stok silinemedi.");
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
      title="Stok sil"
      size="lg"
      footer={
        <>
          {error && <p className="ui-error stock-entry-error" role="alert">{error}</p>}
          <p className="stock-remove-summary" role="status">{unitIds.length} birim silinecek</p>
          <button type="button" className="ui-button ui-button-ghost" onClick={onClose} disabled={busy}>Vazgeç</button>
          <button type="button" className="ui-button ui-button-danger" onClick={remove} disabled={busy || unitIds.length === 0}>
            {busy ? "Bekleyin…" : "Stoktan sil"}
          </button>
        </>
      }
    >
      <div className="ui-stack">
        {units.some((row) => row.serialNo) && (
          <>
            <ScanInput label="Seri no okutun" placeholder="Okutulan birim işaretlenir…" onScan={scanned} autoFocus />
            {scanNote && <p className={`stock-entry-note ${scanNote.tone}`} role="status">{scanNote.text}</p>}
          </>
        )}

        {units.length ? (
          <fieldset className="stock-remove-units">
            <legend className="ui-label">Silinecek birimler</legend>
            <ul>
              {units.map((row) => {
                const picked = Number(counts[row.id]) || 0;
                const id = `remove-row-${row.id}`;
                return (
                  <li key={row.id} className={picked ? "on" : undefined}>
                    <label className="stock-entry-check" htmlFor={id}>
                      <input id={id} type="checkbox" checked={picked > 0} onChange={(event) => toggle(row, event.target.checked)} />
                      <span>
                        <strong className="stock-code">{rowTitle(row)}</strong>
                        <span className="stock-muted"> {rowDetails(row)}</span>
                      </span>
                    </label>
                    {row.count > 1 && picked > 0 && (
                      <label className="ui-field stock-remove-count" htmlFor={`${id}-count`}>
                        <span className="ui-label">Kaç adet</span>
                        <input
                          id={`${id}-count`}
                          className="ui-input"
                          type="number"
                          min={1}
                          max={row.count}
                          step={1}
                          value={picked}
                          onChange={(event) => setCount(row, Math.min(row.count, Math.max(0, Math.floor(Number(event.target.value) || 0))))}
                        />
                      </label>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : (
          <p className="ui-text">Bu modelin stokta birimi yok.</p>
        )}

        <div className="stock-entry-grid">
          <label className="ui-field" htmlFor="remove-reason">
            <span className="ui-label">Neden</span>
            <select id="remove-reason" className="ui-input" value={reason} required onChange={(event) => setReason(event.target.value)}>
              <option value="">Seçin…</option>
              {REMOVAL_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="ui-field stock-entry-wide" htmlFor="remove-note">
            <span className="ui-label">{reason === "other" ? "Not" : "Not (isteğe bağlı)"}</span>
            <textarea id="remove-note" className="ui-input" rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>
        {reason === "entry_error" && (
          <p className="stock-entry-note warn">Bu birimlerin alış gideri kasa defterinden de düşer.</p>
        )}
        <p className="stock-entry-hint">Silinen birimler listeden kalkar ama kaydı ve nedeni saklanır. 6 haneli kodunuz istenir.</p>
      </div>
      {stepUpDialog}
    </Modal>
  );
}
