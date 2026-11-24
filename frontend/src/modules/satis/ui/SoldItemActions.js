"use client";

import { useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import MoneyInput from "@/modules/shared/ui/MoneyInput";
import ScanInput from "@/modules/shared/ui/ScanInput";
import { useToast } from "@/modules/shared/ui/Toast";
import { useStepUpAction } from "@/modules/shared/ui/useStepUpAction";
import { formatDate, todayInClinic } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { buildRefundArgs, buildSoldInfo, refundGuidance } from "../refundRules";
import { refundSaleItem, saveSoldInfo } from "../server/actions";

// The row buttons of Stok > Satılan ürünler: "Bilgiler" (post-sale information) and "İade al".
export function SoldItemActions({ item, methods }) {
  const [open, setOpen] = useState(null); // "info" | "refund" | null
  return (
    <>
      {!item.refunded && item.isDevice && (
        <button type="button" className="sale-link" onClick={() => setOpen("info")}>Bilgiler</button>
      )}
      {!item.refunded && (
        <button type="button" className="sale-link" onClick={() => setOpen("refund")}>İade al</button>
      )}
      {open === "info" && <SoldInfoDialog item={item} onClose={() => setOpen(null)} />}
      {open === "refund" && <RefundDialog item={item} methods={methods} onClose={() => setOpen(null)} />}
    </>
  );
}

// The toolbar's "İade al": the item is found by scanning or picked from the list first (the design's
// "İade: ürünü belirleyin").
export function RefundButton({ items, methods }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ui-button ui-button-ghost" onClick={() => setOpen(true)} disabled={!items.length}>↩ İade al</button>
      {open && <RefundDialog items={items} methods={methods} onClose={() => setOpen(false)} />}
    </>
  );
}

function SoldInfoDialog({ item, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({ productionDate: item.productionDate ?? "", wsaCode: item.wsaCode ?? "", utsNo: item.utsNo ?? "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    const check = buildSoldInfo(form, { item });
    if (check.error) return setError(check.error);
    setBusy(true);
    const result = await saveSoldInfo(item.saleItemId, form);
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "Kaydedilemedi.");
    toast("Satış sonrası bilgiler kaydedildi.");
    onClose();
  }

  const field = (key) => ({ value: form[key], onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })) });

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={`${item.product} · ${item.serial ?? ""}`}
      title="Satış sonrası bilgiler"
      footer={
        <>
          <button type="button" className="ui-button ui-button-ghost" onClick={onClose}>Vazgeç</button>
          <button type="submit" form="sold-info-form" className="ui-button ui-button-primary" disabled={busy}>{busy ? "Bekleyin…" : "Kaydet"}</button>
        </>
      }
    >
      <form id="sold-info-form" className="sale-step" onSubmit={save} noValidate>
        <div className="sale-grid">
          <label className="ui-field" htmlFor="sold-uts"><span className="ui-label">ÜTS bildirim no</span><input id="sold-uts" className="ui-input" maxLength={60} {...field("utsNo")} /></label>
          <label className="ui-field" htmlFor="sold-prod"><span className="ui-label">ÜRT tarihi</span><input id="sold-prod" className="ui-input" type="date" max={item.saleDate} {...field("productionDate")} /></label>
          <label className="ui-field" htmlFor="sold-wsa"><span className="ui-label">WSA kodu</span><input id="sold-wsa" className="ui-input" maxLength={60} {...field("wsaCode")} /></label>
        </div>
        {error && <p className="ui-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

function refundForm(target, today) {
  return { amount: target?.value ?? null, method: target?.paymentMethod ?? "cash", returnsDevice: true, reason: "", refundedOn: today };
}

// "İade al": identify the item → "Bu satış mı?" → amount (at most the item's value) → how the money goes back → whether
// the device returns to the shelf → 6-digit code → create_refund. Afterwards it says how to give the money back.
//   item: the chosen sold item, or items: the refundable ones to choose from.
function RefundDialog({ item: given = null, items = [], methods, onClose }) {
  const toast = useToast();
  const today = todayInClinic();
  const { run, stepUpDialog } = useStepUpAction();
  const [item, setItem] = useState(given);
  const [note, setNote] = useState(null);
  const [form, setForm] = useState(() => refundForm(given, today));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function choose(target) {
    setItem(target);
    setForm(refundForm(target, today));
    setNote(target ? null : "Bu kodla iade edilebilecek bir satış bulunamadı.");
  }
  function scanned(scan) {
    const code = (scan.serial ?? scan.raw ?? "").trim();
    choose(items.find((candidate) => candidate.serial === code) ?? null);
  }

  async function save(event) {
    event.preventDefault();
    const check = buildRefundArgs(form, { item, today });
    if (check.error) return setError(check.error);
    setBusy(true);
    setError(null);
    const result = await run(refundSaleItem, item.saleItemId, form);
    setBusy(false);
    if (result?.ok) {
      toast(`İade kaydedildi. ${refundGuidance(result.data.method, formatMoney(result.data.amount))}`);
      return onClose();
    }
    if (!result?.cancelled) setError(result?.error ?? "İade kaydedilemedi.");
  }

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Satılan ürünler"
      title={item ? "İade et" : "İade: ürünü belirleyin"}
      footer={
        item && (
          <>
            {!given && <button type="button" className="ui-button ui-button-ghost" onClick={() => choose(null)} disabled={busy}>← Geri</button>}
            <button type="submit" form="refund-form" className="ui-button ui-button-primary" disabled={busy}>{busy ? "Bekleyin…" : "İadeyi tamamla"}</button>
          </>
        )
      }
    >
      {!item ? (
        <div className="sale-step">
          <p className="sale-muted">Barkodu okutun ya da aşağıdan satılan ürünü seçin.</p>
          <ScanInput label="Barkod / seri no" onScan={scanned} autoFocus />
          {note && <p className="sale-note warn" role="status">{note}</p>}
          <label className="ui-field" htmlFor="refund-pick">
            <span className="ui-label">veya elle seçin</span>
            <select id="refund-pick" className="ui-input" value="" onChange={(event) => choose(items.find((candidate) => String(candidate.saleItemId) === event.target.value) ?? null)}>
              <option value="">Satılan ürünü seçin…</option>
              {items.map((candidate) => (
                <option key={candidate.saleItemId} value={candidate.saleItemId}>
                  {formatDate(candidate.saleDate)} · {candidate.product}{candidate.serial ? ` · ${candidate.serial}` : ""} · {candidate.buyer ?? ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <form id="refund-form" className="sale-step" onSubmit={save} noValidate>
          <dl className="sale-summary">
            <div className="strong"><dt>Bu satış mı?</dt><dd>{item.saleNo}</dd></div>
            <div><dt>Ürün</dt><dd>{item.product}{item.serial ? ` · ${item.serial}` : ""}</dd></div>
            <div><dt>Hasta / alıcı</dt><dd>{item.buyer ?? "—"}</dd></div>
            <div><dt>Satış tarihi</dt><dd>{formatDate(item.saleDate)}</dd></div>
            <div><dt>Satış fiyatı</dt><dd>{formatMoney(item.value)}</dd></div>
            <div><dt>Ödeme şekli</dt><dd>{item.paymentText ?? "—"}</dd></div>
          </dl>
          <div className="sale-grid">
            <MoneyInput id="refund-amount" label={`İade tutarı (en fazla ${formatMoney(item.value)})`} defaultValue={form.amount} onChange={(amount) => setForm((current) => ({ ...current, amount }))} required />
            <label className="ui-field" htmlFor="refund-method">
              <span className="ui-label">İade ödeme şekli</span>
              <select id="refund-method" className="ui-input" value={form.method} onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))}>
                {methods.map((method) => <option key={method.code} value={method.code}>{method.name}</option>)}
              </select>
            </label>
            <label className="ui-field" htmlFor="refund-date">
              <span className="ui-label">İade tarihi</span>
              <input id="refund-date" className="ui-input" type="date" min={item.saleDate} max={today} value={form.refundedOn} onChange={(event) => setForm((current) => ({ ...current, refundedOn: event.target.value }))} />
            </label>
          </div>
          {item.serial && (
            <label className="sale-tick">
              <input type="checkbox" checked={form.returnsDevice} onChange={(event) => setForm((current) => ({ ...current, returnsDevice: event.target.checked }))} />
              Ürün stoğa geri dönsün
            </label>
          )}
          <label className="ui-field" htmlFor="refund-reason">
            <span className="ui-label">Neden (isteğe bağlı)</span>
            <input id="refund-reason" className="ui-input" maxLength={500} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
          </label>
          <p className="sale-muted">{refundGuidance(form.method, formatMoney(form.amount))} İadeyi tamamlamak için 6 haneli kodunuz istenir.</p>
          {error && <p className="ui-error" role="alert">{error}</p>}
        </form>
      )}
      {stepUpDialog}
    </Modal>
  );
}
