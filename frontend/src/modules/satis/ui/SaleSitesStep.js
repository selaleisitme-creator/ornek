"use client";

import { isEarDevice, sitesFor } from "../saleRules";

// Step 3, "Satış bildirimi ve bağlantılar": per device its ÜTS number and warranty, the invoice, and a tick per site.
// Everything may stay empty and be completed later from the patient history (update_sale_followup).
export default function SaleSitesStep({ catalog, kind, lines, setLines, sale, setSale, onBack, onSave, busy }) {
  const devices = lines.filter((line) => line.type === "unit" && isEarDevice(line.category));
  const sites = sitesFor(kind);
  const wholesale = kind === "wholesale";

  function setLine(key, changes) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...changes } : line)));
  }
  function tick(key, done) {
    setSale((current) => ({ ...current, sites: { ...current.sites, [key]: done } }));
  }

  return (
    <div className="sale-step">
      {sites.map((site) => {
        const link = catalog.sites[site.key];
        return (
          <section key={site.key} className="sale-site">
            <header>
              <span>
                <b>{link?.name ?? site.label}</b>
                <small>{site.hint}</small>
              </span>
              <span className="sale-site-actions">
                {link?.url ? (
                  <a className="ui-button ui-button-ghost" href={link.url} target="_blank" rel="noopener noreferrer">Siteyi aç ↗</a>
                ) : (
                  <small className="sale-muted">Adres Bağlantılar&apos;da girilmemiş</small>
                )}
                <label className="sale-tick">
                  <input type="checkbox" checked={Boolean(sale.sites[site.key])} onChange={(event) => tick(site.key, event.target.checked)} />
                  Tamamlandı
                </label>
              </span>
            </header>

            {site.key === "uts" &&
              devices.map((line) => (
                <label key={line.key} className="ui-field" htmlFor={`uts-${line.key}`}>
                  <span className="ui-label">{line.name} · {line.serial} · bildirim no</span>
                  <input id={`uts-${line.key}`} className="ui-input" maxLength={60} value={line.utsNo} onChange={(event) => setLine(line.key, { utsNo: event.target.value })} />
                </label>
              ))}

            {site.key === "wsa" &&
              !wholesale &&
              devices.map((line) => (
                <label key={line.key} className="ui-field" htmlFor={`wsa-${line.key}`}>
                  <span className="ui-label">{line.name} · {line.serial} · garanti bitişi</span>
                  <input id={`wsa-${line.key}`} className="ui-input" type="date" min={sale.saleDate} value={line.warrantyEnd} onChange={(event) => setLine(line.key, { warrantyEnd: event.target.value })} />
                </label>
              ))}

            {site.key === "kolaysoft" && (
              <div className="sale-grid">
                <label className="ui-field" htmlFor="sale-invoice-mode">
                  <span className="ui-label">Fatura düzeni</span>
                  <select id="sale-invoice-mode" className="ui-input" value={sale.invoiceMode} onChange={(event) => setSale((current) => ({ ...current, invoiceMode: event.target.value }))}>
                    <option value="single">Tek fatura · tüm sepet</option>
                    <option value="per_item">Her ürün / cihaz için ayrı fatura</option>
                  </select>
                </label>
                {sale.invoiceMode === "single" ? (
                  <label className="ui-field" htmlFor="sale-invoice-no">
                    <span className="ui-label">Fatura no</span>
                    <input id="sale-invoice-no" className="ui-input" maxLength={60} value={sale.invoiceNo} onChange={(event) => setSale((current) => ({ ...current, invoiceNo: event.target.value }))} />
                  </label>
                ) : (
                  lines.map((line) => (
                    <label key={line.key} className="ui-field" htmlFor={`invoice-${line.key}`}>
                      <span className="ui-label">{line.name}{line.serial ? ` · ${line.serial}` : ""} · fatura no</span>
                      <input id={`invoice-${line.key}`} className="ui-input" maxLength={60} value={line.invoiceNo ?? ""} onChange={(event) => setLine(line.key, { invoiceNo: event.target.value })} />
                    </label>
                  ))
                )}
              </div>
            )}
          </section>
        );
      })}

      <p className="sale-muted">Kaydı tamamladığınızda satış {wholesale ? "kaydedilir" : "hasta geçmişine işlenir"} ve stok hareketi oluşur. Boş kalan bilgiler sonradan tamamlanabilir.</p>
      <div className="sale-bar">
        <button type="button" className="ui-button ui-button-ghost" onClick={onBack} disabled={busy}>← Sepete dön</button>
        <button type="button" className="ui-button ui-button-primary" onClick={onSave} disabled={busy}>
          {busy ? "Kaydediliyor…" : "✓ Satışı kaydet ve bitir"}
        </button>
      </div>
    </div>
  );
}
