"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { parseScan } from "@/lib/gs1";
import { useToast } from "@/modules/shared/ui/Toast";
import { useStepUpAction } from "@/modules/shared/ui/useStepUpAction";
import { formatMoney } from "@/lib/money";
import {
  PRICE_FIELDS,
  PRICE_MODES,
  PRICE_ROUNDINGS,
  matchesAllWords,
  modelPrice,
  parsePriceValue,
  previewPriceChange,
  priceChangeError,
  sameGtin,
  searchWords,
  stockGroupByCategory,
} from "../stockRules";
import { applyBulkPrices, loadPriceModels } from "../server/actions";

const STATUS_BADGES = {
  ok: { tone: "ok", label: "Değişecek" },
  same: { tone: "neutral", label: "Aynı kalır" },
  bad: { tone: "danger", label: "Sıfır ya da eksi" },
  missing: { tone: "warn", label: "Toptan fiyatı yok" },
};

const VALUE_LABELS = { percent: "Yüzde (zam için 7,5; indirim için -12)", amount: "Tutar (eklemek için 250; düşmek için -250)" };

// "satış" / "toptan satış": the word the titles and messages use for the chosen price.
function priceWord(field) {
  return field === "wholesale" ? "toptan satış" : "satış";
}

function modelText(model) {
  return `${model.brandName} ${model.name}`;
}

// "Fiyat güncelle": choose the retail or the wholesale price, pick models (search, scan, tick), then a new price,
// a percentage or an amount with rounding, previewed old → new before anything is written. The purchase price is
// never changed here, and past sales keep their own prices. The preview and the server use the same rule
// (computeNewPrice).
export default function PriceUpdateDialog({ onClose }) {
  const toast = useToast();
  const { run, stepUpDialog } = useStepUpAction();
  const [step, setStep] = useState(0);
  const [models, setModels] = useState(null); // null while loading
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [scanNote, setScanNote] = useState(null);
  const [field, setField] = useState("sale");
  const [mode, setMode] = useState("set"); // the design opens on "Yeni fiyat"
  const [valueText, setValueText] = useState("");
  const [roundTo, setRoundTo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const searchBox = useRef(null);

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
  const change = { mode, value, roundTo: mode === "set" ? 0 : roundTo, field };
  const changeError = valueText.trim() ? priceChangeError(change) : null;
  const { rows, counts } = previewPriceChange(chosen, change);
  const canApply = !changeError && value !== null && counts.bad === 0 && counts.missing === 0 && counts.ok > 0;

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
      const result = await run(applyBulkPrices, { productIds: [...selected], mode, value, roundTo: change.roundTo, field });
      if (result?.ok) {
        toast(`${result.data?.changed ?? counts.ok} modelin ${priceWord(field)} fiyatı güncellendi.`);
        onClose();
      } else if (!result?.cancelled) {
        setError(result?.error ?? "Fiyatlar güncellenemedi.");
      }
    } finally {
      setBusy(false);
    }
  }

  // The design's single search box: typing filters the list, and a scan (Enter) of a GS1 label or a plain
  // barcode ticks the model with that GTIN. The two chips above it only put the cursor in the box.
  function searchKey(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const text = search.trim();
    if (!text) return;
    const scan = parseScan(text);
    if (!scan.gtin && !/^\d{8,14}$/.test(scan.raw ?? "")) return;
    scanned(scan);
    setSearch("");
  }

  function focusSearch() {
    searchBox.current?.querySelector("input")?.focus();
  }

  const footer =
    step === 0 ? (
      <>
        <button type="button" className="ui-button ui-button-ghost" onClick={onClose}>Vazgeç</button>
        <button type="button" className="ui-button ui-button-primary" onClick={() => setStep(1)} disabled={selected.size === 0}>
          Devam
        </button>
      </>
    ) : (
      <>
        {error && <p className="ui-error stock-entry-error" role="alert">{error}</p>}
        <button type="button" className="ui-button ui-button-ghost" onClick={() => setStep(0)} disabled={busy}>← Geri</button>
        <button type="button" className="ui-button ui-button-primary" onClick={apply} disabled={busy || !canApply}>
          {busy ? "Bekleyin…" : counts.ok ? `${counts.ok} modele uygula` : "Uygula"}
        </button>
      </>
    );

  const title =
    step === 0 ? (
      <>Fiyat güncelle <span className="stock-modal-step">· 1/2 Ürün seç</span></>
    ) : (
      <>
        {field === "wholesale" ? "Toptan satış fiyatını güncelle" : "Satış fiyatını güncelle"}{" "}
        <span className="stock-modal-step strong">· 2/2 Yeni fiyat</span>
      </>
    );

  return (
    <Modal open onClose={onClose} title={title} size="lg" footer={footer}>
      <div className="stock-price-dialog">
        {step === 0 && (
          <>
            <p className="stock-modal-lead">
              Fiyatı güncellenecek modelleri işaretleyin. Daha önce tamamlanan satışlar değişmez.
            </p>

            <fieldset className="stock-price-kind">
              <legend>Hangi fiyat güncellenecek?</legend>
              {PRICE_FIELDS.map((option) => (
                <label key={option.value} className={`stock-price-kind-card${field === option.value ? " on" : ""}`}>
                  <input
                    type="radio"
                    name="price-kind"
                    value={option.value}
                    checked={field === option.value}
                    onChange={() => setField(option.value)}
                  />
                  <span>
                    <b>{option.label} fiyatı</b>
                    <small>{option.hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="stock-price-search" ref={searchBox}>
              <div className="stock-scan-helper" aria-label="Okutma">
                <button type="button" onClick={focusSearch}>▦ Barkod okut</button>
                <button type="button" onClick={focusSearch}>№ Seri no okut</button>
              </div>
              <input
                className="ui-input"
                type="search"
                autoComplete="off"
                aria-label="Ürün adı, barkod veya seri no ara"
                placeholder="Ürün adı, barkod veya seri no ara…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={searchKey}
              />
            </div>
            {scanNote && <p className={`stock-entry-note ${scanNote.tone}`} role="status">{scanNote.text}</p>}

            <div className="stock-price-pick-bar">
              <span role="status">{selected.size ? `${selected.size} model seçildi` : "Henüz ürün seçilmedi"}</span>
              <button type="button" className="stock-link-button" onClick={selectVisible} disabled={!visible.length}>
                Görünenleri seç
              </button>
              <button type="button" className="stock-link-button" onClick={() => setSelected(new Set())} disabled={!selected.size}>
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
                      <label htmlFor={id}>
                        <input id={id} type="checkbox" checked={on} onChange={(event) => toggle(model.id, event.target.checked)} />
                        <span className="stock-price-model-name">
                          <b>{model.name}</b>
                          <small>
                            {model.brandName} · {stockGroupByCategory(model.category).label}
                          </small>
                        </span>
                        <span className="stock-price-model-price">{formatMoney(modelPrice(model, field))}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <ul className="stock-price-chips" aria-label="Seçilen modeller">
              {chosen.map((model) => (
                <li key={model.id}>{modelText(model)}</li>
              ))}
            </ul>

            <div className="stock-sections stock-price-modes" role="group" aria-label="Yöntem">
              {PRICE_MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={mode === option.value ? "on" : undefined}
                  aria-pressed={mode === option.value}
                  onClick={() => chooseMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className={`stock-price-fields${mode === "set" ? " single" : ""}`}>
              <label className="ui-field" htmlFor="price-value">
                <span className="ui-label">{mode === "set" ? `Yeni ${priceWord(field)} fiyatı` : VALUE_LABELS[mode]}</span>
                <span className={`ui-input-wrap${changeError ? " invalid" : ""}`}>
                  <input
                    id="price-value"
                    className="ui-input ui-input-money"
                    inputMode={mode === "set" ? "decimal" : "text"}
                    autoComplete="off"
                    placeholder={mode === "set" ? "örn. 20.000" : mode === "percent" ? "7,5" : "250"}
                    value={valueText}
                    aria-invalid={Boolean(changeError) || undefined}
                    onChange={(event) => setValueText(event.target.value)}
                  />
                  <span className="ui-input-suffix">{mode === "percent" ? "%" : "TL"}</span>
                </span>
                {changeError ? (
                  <span className="ui-error">{changeError}</span>
                ) : (
                  <span className="stock-modal-hint">Türkçe biçim: 20.000 veya 7.491,64. Seçili bütün modellere uygulanır.</span>
                )}
              </label>
              {/* Rounding only means something for percent and amount; a typed new price is used as is. */}
              {mode !== "set" && (
                <label className="ui-field" htmlFor="price-round">
                  <span className="ui-label">Yuvarlama</span>
                  <select id="price-round" className="ui-input" value={roundTo} onChange={(event) => setRoundTo(Number(event.target.value))}>
                    {PRICE_ROUNDINGS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {value === null || changeError ? (
              <p className="stock-price-preview-empty">Değeri girin; eski ve yeni fiyatlar burada görünür.</p>
            ) : (
              <div className="stock-price-preview">
                <table>
                  <caption className="ui-visually-hidden">Fiyat önizlemesi</caption>
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col" className="ui-end">Eski</th>
                      <th scope="col" className="ui-end">Yeni</th>
                      <th scope="col">Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.productId}>
                        <td>{row.brandName} {row.name}</td>
                        <td className="ui-end">{formatMoney(row.oldPrice)}</td>
                        <td className="ui-end"><b>{row.newPrice === null ? "—" : formatMoney(row.newPrice)}</b></td>
                        <td>
                          {row.status ? <StatusBadge tone={STATUS_BADGES[row.status].tone}>{STATUS_BADGES[row.status].label}</StatusBadge> : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="stock-entry-summary" role="status">
                  {counts.ok} model değişecek{counts.same ? ` · ${counts.same} model aynı kalacak` : ""}
                  {counts.bad ? ` · ${counts.bad} modelin yeni fiyatı sıfır ya da eksi` : ""}
                  {counts.missing ? ` · ${counts.missing} modelin toptan fiyatı yok` : ""}
                </p>
              </div>
            )}
            {counts.bad > 0 && <p className="stock-entry-note warn">Yeni fiyatı sıfır ya da eksi olan model varken fiyatlar uygulanmaz.</p>}
            {counts.missing > 0 && (
              <p className="stock-entry-note warn">
                Toptan fiyatı olmayan modele yüzde ya da tutar uygulanamaz. &quot;Yeni fiyat&quot; ile fiyat verin ya da o modeli
                seçimden çıkarın.
              </p>
            )}
            <p className="stock-modal-hint">
              Bu işlem modellerin {priceWord(field)} fiyatını günceller; daha önce tamamlanan satışlar değişmez. Uygulamadan önce 6 haneli kodunuz istenir.
            </p>
          </>
        )}
      </div>
      {stepUpDialog}
    </Modal>
  );
}
