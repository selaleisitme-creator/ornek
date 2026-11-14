"use client";

import { useEffect, useMemo, useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import Stepper from "@/modules/shared/ui/Stepper";
import ScanInput from "@/modules/shared/ui/ScanInput";
import DataTable from "@/modules/shared/ui/DataTable";
import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { useToast } from "@/modules/shared/ui/Toast";
import { useStepUpAction } from "@/modules/shared/ui/useStepUpAction";
import { formatMoney } from "@/lib/money";
import {
  PRICE_MODES,
  PRICE_ROUNDINGS,
  matchesAllWords,
  parsePriceValue,
  previewPriceChange,
  priceChangeError,
  sameGtin,
  searchWords,
  stockGroupByCategory,
} from "../stockRules";
import { applyBulkPrices, loadPriceModels } from "../server/actions";

const STEPS = ["Modelleri seç", "Yöntem ve önizleme"];

const STATUS_BADGES = {
  ok: { tone: "ok", label: "Değişecek" },
  same: { tone: "neutral", label: "Aynı kalır" },
  bad: { tone: "danger", label: "Sıfır ya da eksi" },
};

const VALUE_LABELS = { set: "Yeni satış fiyatı", percent: "Yüzde (zam için 7,5; indirim için -12)", amount: "Tutar (eklemek için 250; düşmek için -250)" };

function modelText(model) {
  return `${model.brandName} ${model.name}`;
}

// "Fiyat güncelle": pick models (search, scan, tick), then a new price, a percentage or an amount with
// rounding, previewed old → new before anything is written. Only the sale price changes (Faz 1 decision 4);
// past sales keep their own prices. The preview and the server use the same rule (computeNewPrice).
export default function PriceUpdateDialog({ onClose }) {
  const toast = useToast();
  const { run, stepUpDialog } = useStepUpAction();
  const [step, setStep] = useState(0);
  const [models, setModels] = useState(null); // null while loading
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [scanNote, setScanNote] = useState(null);
  const [mode, setMode] = useState("percent");
  const [valueText, setValueText] = useState("");
  const [roundTo, setRoundTo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Loaded when the window opens, so every opening starts from the current prices.
  useEffect(() => {
    let alive = true;
    loadPriceModels().then((result) => {
      if (!alive) return;
      if (result?.ok) setModels(result.data ?? []);
      else setLoadError(result?.error ?? "Modeller yüklenemedi.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const visible = useMemo(() => {
    const words = searchWords(search);
    return (models ?? []).filter((model) => matchesAllWords(modelText(model), words));
  }, [models, search]);

  const chosen = useMemo(() => (models ?? []).filter((model) => selected.has(model.id)), [models, selected]);

  const value = parsePriceValue(mode, valueText);
  const change = { mode, value, roundTo: mode === "set" ? 0 : roundTo };
  const changeError = valueText.trim() ? priceChangeError(change) : null;
  const { rows, counts } = previewPriceChange(chosen, change);
  const canApply = !changeError && value !== null && counts.bad === 0 && counts.ok > 0;

  function toggle(id, checked) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectVisible() {
    setSelected((current) => new Set([...current, ...visible.map((model) => model.id)]));
  }

  // A scanned GS1 label (or a plain barcode) ticks the model with that GTIN.
  function scanned(scan) {
    const code = scan.gtin ?? (/^\d{8,14}$/.test(scan.raw ?? "") ? scan.raw : null);
    const model = code ? (models ?? []).find((item) => sameGtin(item.gtin, code)) : null;
    if (!model) {
      setScanNote({ tone: "warn", text: `${code ?? scan.raw ?? "Okutulan kod"} hiçbir modelin GTIN'i değil.` });
      return;
    }
    toggle(model.id, true);
    setScanNote({ tone: "info", text: `${modelText(model)} seçildi.` });
  }

  function chooseMode(next) {
    setMode(next);
    setValueText("");
    setError(null);
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const result = await run(applyBulkPrices, { productIds: [...selected], mode, value, roundTo: change.roundTo });
      if (result?.ok) {
        toast(`${result.data?.changed ?? counts.ok} modelin satış fiyatı güncellendi.`);
        onClose();
      } else if (!result?.cancelled) {
        setError(result?.error ?? "Fiyatlar güncellenemedi.");
      }
    } finally {
      setBusy(false);
    }
  }

  const footer =
    step === 0 ? (
      <>
        <p className="stock-remove-summary" role="status">{selected.size} model seçildi</p>
        <button type="button" className="ui-button ui-button-ghost" onClick={onClose}>Vazgeç</button>
        <button type="button" className="ui-button ui-button-primary" onClick={() => setStep(1)} disabled={selected.size === 0}>
          Devam
        </button>
      </>
    ) : (
      <>
        {error && <p className="ui-error stock-entry-error" role="alert">{error}</p>}
        <button type="button" className="ui-button ui-button-ghost" onClick={() => setStep(0)} disabled={busy}>Geri</button>
        <button type="button" className="ui-button ui-button-primary" onClick={apply} disabled={busy || !canApply}>
          {busy ? "Bekleyin…" : `${counts.ok} modele uygula`}
        </button>
      </>
    );

  return (
    <Modal open onClose={onClose} eyebrow="Stok · Satış fiyatı" title="Fiyat güncelle" size="lg" footer={footer}>
      <div className="ui-stack">
        <Stepper steps={STEPS} current={step} />

        {step === 0 && (
          <>
            <div className="stock-entry-grid">
              <label className="ui-field" htmlFor="price-search">
                <span className="ui-label">Model ara</span>
                <input
                  id="price-search"
                  className="ui-input"
                  type="search"
                  autoComplete="off"
                  placeholder="Marka ya da model adı…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <ScanInput label="Barkod okut" placeholder="Okutulan model seçilir…" onScan={scanned} />
            </div>
            {scanNote && <p className={`stock-entry-note ${scanNote.tone}`} role="status">{scanNote.text}</p>}

            <div className="stock-price-pick-actions">
              <button type="button" className="ui-button ui-button-ghost" onClick={selectVisible} disabled={!visible.length}>
                Görünenleri seç
              </button>
              <button type="button" className="ui-button ui-button-ghost" onClick={() => setSelected(new Set())} disabled={!selected.size}>
                Temizle
              </button>
            </div>

            {loadError && <p className="ui-error" role="alert">{loadError}</p>}
            {!loadError && models === null && <p className="stock-muted" role="status">Modeller yükleniyor…</p>}
            {models !== null && !visible.length && (
              <p className="stock-muted">{models.length ? "Aramaya uyan model yok." : "Kayıtlı aktif model yok."}</p>
            )}
            {visible.length > 0 && (
              <ul className="stock-price-models" aria-label="Modeller">
                {visible.map((model) => {
                  const id = `price-model-${model.id}`;
                  const on = selected.has(model.id);
                  return (
                    <li key={model.id} className={on ? "on" : undefined}>
                      <label className="stock-entry-check" htmlFor={id}>
                        <input id={id} type="checkbox" checked={on} onChange={(event) => toggle(model.id, event.target.checked)} />
                        <span>
                          <strong>{modelText(model)}</strong>
                          <span className="stock-muted"> {stockGroupByCategory(model.category).label}</span>
                        </span>
                      </label>
                      <span className="stock-price">{formatMoney(model.salePrice)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <fieldset className="stock-entry-choices">
              <legend className="ui-label">Yöntem</legend>
              {PRICE_MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`stock-entry-choice${mode === option.value ? " on" : ""}`}
                  aria-pressed={mode === option.value}
                  onClick={() => chooseMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </fieldset>

            <div className="stock-entry-grid">
              <label className="ui-field" htmlFor="price-value">
                <span className="ui-label">{VALUE_LABELS[mode]}</span>
                <span className={`ui-input-wrap${changeError ? " invalid" : ""}`}>
                  <input
                    id="price-value"
                    className="ui-input ui-input-money"
                    inputMode={mode === "set" ? "decimal" : "text"}
                    autoComplete="off"
                    placeholder={mode === "percent" ? "7,5" : "0,00"}
                    value={valueText}
                    aria-invalid={Boolean(changeError) || undefined}
                    onChange={(event) => setValueText(event.target.value)}
                  />
                  <span className="ui-input-suffix">{mode === "percent" ? "%" : "TL"}</span>
                </span>
                {changeError && <span className="ui-error">{changeError}</span>}
              </label>
              <label className="ui-field" htmlFor="price-round">
                <span className="ui-label">Yuvarlama</span>
                <select
                  id="price-round"
                  className="ui-input"
                  value={mode === "set" ? 0 : roundTo}
                  disabled={mode === "set"}
                  onChange={(event) => setRoundTo(Number(event.target.value))}
                >
                  {PRICE_ROUNDINGS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>

            <DataTable
              caption="Fiyat önizlemesi"
              rowKey="productId"
              rows={rows}
              columns={[
                { key: "name", label: "Model", render: (row) => `${row.brandName} ${row.name}` },
                { key: "oldPrice", label: "Eski", align: "end", render: (row) => formatMoney(row.oldPrice) },
                { key: "newPrice", label: "Yeni", align: "end", render: (row) => (row.newPrice === null ? "—" : formatMoney(row.newPrice)) },
                {
                  key: "status",
                  label: "Durum",
                  render: (row) =>
                    row.status ? <StatusBadge tone={STATUS_BADGES[row.status].tone}>{STATUS_BADGES[row.status].label}</StatusBadge> : "—",
                },
              ]}
            />

            {value !== null && !changeError && (
              <p className="stock-entry-summary" role="status">
                {counts.ok} model değişecek{counts.same ? ` · ${counts.same} model aynı kalacak` : ""}
                {counts.bad ? ` · ${counts.bad} modelin yeni fiyatı sıfır ya da eksi` : ""}
              </p>
            )}
            {counts.bad > 0 && (
              <p className="stock-entry-note warn">Yeni fiyatı sıfır ya da eksi olan model varken fiyatlar uygulanmaz.</p>
            )}
            <p className="stock-entry-hint">Daha önce tamamlanan satışlar değişmez. Uygulamadan önce 6 haneli kodunuz istenir.</p>
          </>
        )}
      </div>
      {stepUpDialog}
    </Modal>
  );
}
