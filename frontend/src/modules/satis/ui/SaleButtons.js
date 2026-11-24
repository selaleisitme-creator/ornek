"use client";

import { useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import MoneyInput from "@/modules/shared/ui/MoneyInput";
import { useToast } from "@/modules/shared/ui/Toast";
import { formatMoney } from "@/lib/money";
import { todayInClinic } from "@/lib/dates";
import { buildPaymentRow, isEarDevice, sitesFor } from "../saleRules";
import { addSalePayment, loadSaleBalance, loadSaleCatalog, loadSaleFollowup, saveSaleFollowup } from "../server/actions";
import SaleWizard from "./SaleWizard";
import "./sale.css";

// The patient card's selling buttons. Each one owns its window, so the card itself stays a server component.

// "＋ Hasta işlem": opens the sale wizard for this patient.
export function NewSaleButton({ patient }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ui-button ui-button-primary" onClick={() => setOpen(true)}>＋ Hasta işlem</button>
      {open && <SaleWizard patient={patient} onClose={() => setOpen(false)} />}
    </>
  );
}

// "Site işlemleri": ÜTS numbers, warranty dates, invoice numbers and ticks, filled in after the sale.
export function SaleFollowupButton({ saleId, patientId }) {
  const toast = useToast();
  const [form, setForm] = useState(null); // null while closed
  const [sites, setSites] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setError(null);
    const [sale, catalog] = await Promise.all([loadSaleFollowup(saleId, patientId), loadSaleCatalog()]);
    if (!sale?.ok) return toast(sale?.error ?? "Satış yüklenemedi.", "error");
    if (catalog?.ok) setSites(catalog.data.sites);
    setForm({ ...sale.data, ticks: Object.fromEntries(sale.data.ticked.map((key) => [key, true])) });
  }

  function setItem(saleItemId, changes) {
    setForm((current) => ({ ...current, items: current.items.map((item) => (item.saleItemId === saleItemId ? { ...item, ...changes } : item)) }));
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const keys = sitesFor(form.kind).map((site) => site.key);
    const result = await saveSaleFollowup(saleId, patientId, {
      items: form.items,
      invoiceNo: form.invoiceNo,
      sites: Object.fromEntries(keys.map((key) => [key, Boolean(form.ticks[key])])),
    });
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "Kaydedilemedi.");
    toast("Site işlemleri kaydedildi.");
    setForm(null);
  }

  const devices = form?.items.filter((item) => isEarDevice(item.category)) ?? [];

  return (
    <>
      <button type="button" className="ui-button ui-button-ghost" onClick={open}>Site işlemleri</button>
      {form && (
        <Modal
          open
          onClose={() => setForm(null)}
          eyebrow="Satış bildirimi"
          title="Site işlemleri"
          size="lg"
          footer={
            <>
              <button type="button" className="ui-button ui-button-ghost" onClick={() => setForm(null)}>Vazgeç</button>
              <button type="submit" form="sale-followup-form" className="ui-button ui-button-primary" disabled={busy}>{busy ? "Bekleyin…" : "Kaydet"}</button>
            </>
          }
        >
          <form id="sale-followup-form" className="sale-step" onSubmit={save} noValidate>
            {sitesFor(form.kind).map((site) => (
              <section key={site.key} className="sale-site">
                <header>
                  <span>
                    <b>{sites[site.key]?.name ?? site.label}</b>
                    <small>{site.hint}</small>
                  </span>
                  <span className="sale-site-actions">
                    {sites[site.key]?.url && (
                      <a className="ui-button ui-button-ghost" href={sites[site.key].url} target="_blank" rel="noopener noreferrer">Siteyi aç ↗</a>
                    )}
                    <label className="sale-tick">
                      <input type="checkbox" checked={Boolean(form.ticks[site.key])} onChange={(event) => setForm((current) => ({ ...current, ticks: { ...current.ticks, [site.key]: event.target.checked } }))} />
                      Tamamlandı
                    </label>
                  </span>
                </header>
                {site.key === "uts" && devices.map((item) => (
                  <label key={item.saleItemId} className="ui-field" htmlFor={`f-uts-${item.saleItemId}`}>
                    <span className="ui-label">{item.name} · {item.serial} · bildirim no</span>
                    <input id={`f-uts-${item.saleItemId}`} className="ui-input" maxLength={60} value={item.utsNo} onChange={(event) => setItem(item.saleItemId, { utsNo: event.target.value })} />
                  </label>
                ))}
                {site.key === "wsa" && devices.map((item) => (
                  <label key={item.saleItemId} className="ui-field" htmlFor={`f-wsa-${item.saleItemId}`}>
                    <span className="ui-label">{item.name} · {item.serial} · garanti bitişi</span>
                    <input id={`f-wsa-${item.saleItemId}`} className="ui-input" type="date" min={item.warrantyStart} value={item.warrantyEnd} onChange={(event) => setItem(item.saleItemId, { warrantyEnd: event.target.value })} />
                  </label>
                ))}
                {site.key === "kolaysoft" &&
                  (form.invoiceMode === "single" ? (
                    <label className="ui-field" htmlFor="f-invoice">
                      <span className="ui-label">Fatura no</span>
                      <input id="f-invoice" className="ui-input" maxLength={60} value={form.invoiceNo} onChange={(event) => setForm((current) => ({ ...current, invoiceNo: event.target.value }))} />
                    </label>
                  ) : (
                    form.items.map((item) => (
                      <label key={item.saleItemId} className="ui-field" htmlFor={`f-inv-${item.saleItemId}`}>
                        <span className="ui-label">{item.name}{item.serial ? ` · ${item.serial}` : ""} · fatura no</span>
                        <input id={`f-inv-${item.saleItemId}`} className="ui-input" maxLength={60} value={item.invoiceNo} onChange={(event) => setItem(item.saleItemId, { invoiceNo: event.target.value })} />
                      </label>
                    ))
                  ))}
              </section>
            ))}
            {error && <p className="ui-error" role="alert">{error}</p>}
          </form>
        </Modal>
      )}
    </>
  );
}

// "Tahsilat ekle": a later payment from the patient, or the money SGK paid. What is owed comes from the database.
export function PaymentButton({ saleId, patientId }) {
  const toast = useToast();
  const today = todayInClinic();
  const [due, setDue] = useState(null); // null while closed
  const [methods, setMethods] = useState([]);
  const [form, setForm] = useState({ payer: "patient", method: "cash", amount: null, installments: "", paidOn: today });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setError(null);
    const [balance, catalog] = await Promise.all([loadSaleBalance(saleId, patientId), loadSaleCatalog()]);
    if (!balance?.ok) return toast(balance?.error ?? "Satış yüklenemedi.", "error");
    if (catalog?.ok) setMethods(catalog.data.paymentMethods);
    if (balance.data.patient <= 0 && balance.data.sgk <= 0) return toast("Bu satışta kalan borç ya da beklenen SGK ödemesi yok.");
    setForm({ payer: balance.data.patient > 0 ? "patient" : "sgk", method: "cash", amount: null, installments: "", paidOn: today });
    setDue(balance.data);
  }

  async function save(event) {
    event.preventDefault();
    const check = buildPaymentRow(form, { due, today });
    if (check.error) return setError(check.error);
    setBusy(true);
    setError(null);
    const result = await addSalePayment(saleId, patientId, form);
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "Tahsilat kaydedilemedi.");
    toast("Tahsilat kaydedildi.");
    setDue(null);
  }

  return (
    <>
      <button type="button" className="ui-button ui-button-ghost" onClick={open}>Tahsilat ekle</button>
      {due && (
        <Modal
          open
          onClose={() => setDue(null)}
          eyebrow="Satış"
          title="Tahsilat ekle"
          footer={
            <>
              <button type="button" className="ui-button ui-button-ghost" onClick={() => setDue(null)}>Vazgeç</button>
              <button type="submit" form="sale-payment-form" className="ui-button ui-button-primary" disabled={busy}>{busy ? "Bekleyin…" : "Kaydet"}</button>
            </>
          }
        >
          <form id="sale-payment-form" className="sale-step" onSubmit={save} noValidate>
            <dl className="sale-summary">
              <div><dt>Hastanın kalan borcu</dt><dd>{formatMoney(due.patient)}</dd></div>
              <div><dt>SGK&apos;dan beklenen</dt><dd>{formatMoney(due.sgk)}</dd></div>
            </dl>
            <div className="sale-grid">
              <label className="ui-field" htmlFor="pay-payer">
                <span className="ui-label">Kimden</span>
                <select id="pay-payer" className="ui-input" value={form.payer} onChange={(event) => setForm((current) => ({ ...current, payer: event.target.value }))}>
                  {due.patient > 0 && <option value="patient">Hasta</option>}
                  {due.sgk > 0 && <option value="sgk">SGK</option>}
                </select>
              </label>
              <label className="ui-field" htmlFor="pay-method">
                <span className="ui-label">Ödeme şekli</span>
                <select id="pay-method" className="ui-input" value={form.method} onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))}>
                  {methods.map((method) => <option key={method.code} value={method.code}>{method.name}</option>)}
                </select>
              </label>
              <MoneyInput id="pay-amount" label="Tutar" defaultValue={null} onChange={(amount) => setForm((current) => ({ ...current, amount }))} required />
              <label className="ui-field" htmlFor="pay-date">
                <span className="ui-label">Tarih</span>
                <input id="pay-date" className="ui-input" type="date" max={today} value={form.paidOn} onChange={(event) => setForm((current) => ({ ...current, paidOn: event.target.value }))} />
              </label>
              {(form.method === "installment" || form.method === "card_pos") && (
                <label className="ui-field" htmlFor="pay-inst">
                  <span className="ui-label">Taksit (isteğe bağlı)</span>
                  <input id="pay-inst" className="ui-input" type="number" min={2} value={form.installments} onChange={(event) => setForm((current) => ({ ...current, installments: event.target.value }))} />
                </label>
              )}
            </div>
            {error && <p className="ui-error" role="alert">{error}</p>}
          </form>
        </Modal>
      )}
    </>
  );
}
