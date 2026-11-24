"use client";

import MoneyInput from "@/modules/shared/ui/MoneyInput";
import { formatMoney } from "@/lib/money";
import { TAX_RATES, cartTotals, isEarDevice, paymentSummary, taxLocked } from "../saleRules";

const SIDES = [
  { value: "right", label: "Sağ" },
  { value: "left", label: "Sol" },
  { value: "both", label: "İki kulak" },
];

// Step 2, "Sepet ve ödeme": each line's price (VAT included), VAT rate, side, mould or note; the sale date, discount, SGK
// share and the payments. What stays unpaid is shown as "Kalan (alacak)"; the sale is still saved.
export default function SaleCartStep({ catalog, wholesale, lines, setLines, sale, setSale, today, onBack, onNext, nextLabel, busy }) {
  const totals = cartTotals(lines, sale.discount ?? 0);
  const summary = paymentSummary(totals.total, wholesale ? 0 : sale.sgkAmount ?? 0, sale.payments);

  function setLine(key, changes) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...changes } : line)));
  }
  function setPayment(key, changes) {
    setSale((current) => ({ ...current, payments: current.payments.map((row) => (row.key === key ? { ...row, ...changes } : row)) }));
  }
  function addPayment() {
    setSale((current) => ({ ...current, payments: [...current.payments, { key: Date.now(), method: "card_pos", amount: null, installments: "" }] }));
  }
  function removePayment(key) {
    setSale((current) => ({ ...current, payments: current.payments.filter((row) => row.key !== key) }));
  }

  return (
    <div className="sale-step">
      {wholesale && (
        <div className="sale-grid">
          <label className="ui-field" htmlFor="sale-customer">
            <span className="ui-label">Alıcı (işitme merkezi)</span>
            <input id="sale-customer" className="ui-input" maxLength={160} value={sale.customerName} onChange={(event) => setSale((current) => ({ ...current, customerName: event.target.value }))} />
          </label>
          <label className="ui-field" htmlFor="sale-customer-phone">
            <span className="ui-label">Telefon (isteğe bağlı)</span>
            <input id="sale-customer-phone" className="ui-input" inputMode="tel" maxLength={20} value={sale.customerPhone} onChange={(event) => setSale((current) => ({ ...current, customerPhone: event.target.value }))} />
          </label>
        </div>
      )}

      <ul className="sale-cart" aria-label="Sepet">
        {lines.map((line) => (
          <li key={line.key} className="sale-cart-line">
            <div className="sale-cart-head">
              <span>
                <b>{line.name}</b>
                <small>{line.serial ? `Seri: ${line.serial} · 1 adet` : line.type === "custom" ? "Elle eklenen servis" : line.type === "service" ? "Hizmet" : "Seri numarasız"}</small>
              </span>
              <button type="button" className="sale-link" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>Kaldır</button>
            </div>
            <div className="sale-cart-fields">
              <MoneyInput id={`price-${line.key}`} label="Birim fiyat (KDV dahil)" defaultValue={line.unitPrice} onChange={(unitPrice) => setLine(line.key, { unitPrice })} required />
              <label className="ui-field" htmlFor={`tax-${line.key}`}>
                <span className="ui-label">KDV</span>
                <select id={`tax-${line.key}`} className="ui-input" value={line.taxRate} disabled={taxLocked(line.category)} onChange={(event) => setLine(line.key, { taxRate: Number(event.target.value) })}>
                  {TAX_RATES.filter((rate) => taxLocked(line.category) || rate !== 0 || line.taxRate === 0).map((rate) => (
                    <option key={rate} value={rate}>%{rate}</option>
                  ))}
                </select>
              </label>
              {line.type !== "unit" && line.type !== "custom" && (
                <label className="ui-field" htmlFor={`qty-${line.key}`}>
                  <span className="ui-label">Adet{line.maxQuantity ? ` (stokta ${line.maxQuantity})` : ""}</span>
                  <input id={`qty-${line.key}`} className="ui-input" type="number" min={1} max={line.maxQuantity ?? undefined} value={line.quantity} onChange={(event) => setLine(line.key, { quantity: Number(event.target.value) })} />
                </label>
              )}
              {line.type === "unit" && isEarDevice(line.category) && (
                <label className="ui-field" htmlFor={`side-${line.key}`}>
                  <span className="ui-label">Kulak</span>
                  <select id={`side-${line.key}`} className="ui-input" value={line.earSide} onChange={(event) => setLine(line.key, { earSide: event.target.value })}>
                    <option value="">Taraf seçin</option>
                    {SIDES.map((side) => <option key={side.value} value={side.value}>{side.label}</option>)}
                  </select>
                </label>
              )}
              {line.category === "dome" && (
                <label className="ui-field" htmlFor={`mold-${line.key}`}>
                  <span className="ui-label">Kalıp cinsi</span>
                  <input id={`mold-${line.key}`} className="ui-input" maxLength={120} value={line.moldType} onChange={(event) => setLine(line.key, { moldType: event.target.value })} />
                </label>
              )}
              {(line.type === "service" || line.type === "custom") && (
                <label className="ui-field sale-wide" htmlFor={`note-${line.key}`}>
                  <span className="ui-label">Yapılan işlem / değişen parça</span>
                  <input id={`note-${line.key}`} className="ui-input" maxLength={500} value={line.serviceNote} onChange={(event) => setLine(line.key, { serviceNote: event.target.value })} />
                </label>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="sale-grid">
        <label className="ui-field" htmlFor="sale-date">
          <span className="ui-label">Satış tarihi</span>
          <input id="sale-date" className="ui-input" type="date" max={today} value={sale.saleDate} onChange={(event) => setSale((current) => ({ ...current, saleDate: event.target.value }))} />
        </label>
        <MoneyInput id="sale-discount" label="İndirim (TL)" defaultValue={sale.discount} onChange={(discount) => setSale((current) => ({ ...current, discount }))} />
        {!wholesale && (
          <MoneyInput id="sale-sgk" label="SGK katkı tutarı (fiyatın içinde)" defaultValue={sale.sgkAmount} onChange={(sgkAmount) => setSale((current) => ({ ...current, sgkAmount }))} />
        )}
      </div>

      <fieldset className="sale-payments">
        <legend>Ödeme</legend>
        {sale.payments.map((row) => (
          <div key={row.key} className="sale-payment-row">
            <label className="ui-field" htmlFor={`pay-method-${row.key}`}>
              <span className="ui-label">Ödeme şekli</span>
              <select id={`pay-method-${row.key}`} className="ui-input" value={row.method} onChange={(event) => setPayment(row.key, { method: event.target.value })}>
                {catalog.paymentMethods.map((method) => <option key={method.code} value={method.code}>{method.name}</option>)}
              </select>
            </label>
            <MoneyInput id={`pay-amount-${row.key}`} label="Tutar" defaultValue={row.amount} onChange={(amount) => setPayment(row.key, { amount })} />
            {(row.method === "installment" || row.method === "card_pos") && (
              <label className="ui-field" htmlFor={`pay-inst-${row.key}`}>
                <span className="ui-label">Taksit (isteğe bağlı)</span>
                <input id={`pay-inst-${row.key}`} className="ui-input" type="number" min={2} value={row.installments} onChange={(event) => setPayment(row.key, { installments: event.target.value })} />
              </label>
            )}
            {sale.payments.length > 1 && (
              <button type="button" className="sale-link" onClick={() => removePayment(row.key)}>Kaldır</button>
            )}
          </div>
        ))}
        <button type="button" className="sale-link" onClick={addPayment}>＋ Ödeme satırı ekle</button>
      </fieldset>

      <dl className="sale-summary">
        <div><dt>Ara toplam</dt><dd>{formatMoney(totals.gross)}</dd></div>
        {totals.discount > 0 && <div><dt>İndirim</dt><dd>− {formatMoney(totals.discount)}</dd></div>}
        <div className="strong"><dt>Toplam (KDV dahil)</dt><dd>{formatMoney(totals.total)}</dd></div>
        <div><dt>İçindeki KDV</dt><dd>{formatMoney(totals.vat)}</dd></div>
        {!wholesale && summary.sgk > 0 && <div><dt>SGK&apos;dan beklenen</dt><dd>{formatMoney(summary.sgk)}</dd></div>}
        <div><dt>{wholesale ? "Alıcının ödeyeceği" : "Hastanın payı"}</dt><dd>{formatMoney(summary.patientShare)}</dd></div>
        <div><dt>Ödenen</dt><dd>{formatMoney(summary.paid)}</dd></div>
        <div className={summary.remaining > 0 ? "due" : undefined}><dt>Kalan (alacak)</dt><dd>{formatMoney(summary.remaining)}</dd></div>
      </dl>

      <div className="sale-bar">
        <button type="button" className="ui-button ui-button-ghost" onClick={onBack} disabled={busy}>← Ürün ekle</button>
        <button type="button" className="ui-button ui-button-primary" onClick={onNext} disabled={busy || !lines.length}>
          {busy ? "Bekleyin…" : nextLabel}
        </button>
      </div>
    </div>
  );
}
