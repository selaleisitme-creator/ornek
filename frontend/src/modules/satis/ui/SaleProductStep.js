"use client";

import { useState } from "react";
import ScanInput from "@/modules/shared/ui/ScanInput";
import MoneyInput from "@/modules/shared/ui/MoneyInput";
import { formatMoney } from "@/lib/money";
import { SALE_GROUPS, cartTotals } from "../saleRules";
import { findSaleItemByCode, loadGroupModels, loadModelUnits } from "../server/actions";

function scanText(scan) {
  if (scan.gtin) return `(01)${scan.gtin}${scan.serial ? `(21)${scan.serial}` : ""}`;
  return scan.raw ?? "";
}

// Step 1, "<hasta> için ürün ekleyin": scan or search, or pick by group → model → unit. Services come from the price list,
// or are typed in ("＋ Elle ekle"). add.* returns null when the item went in, or a Turkish sentence why not.
export default function SaleProductStep({ catalog, wholesale, lines, add, onNext }) {
  const [group, setGroup] = useState(null);
  const [models, setModels] = useState(null);
  const [model, setModel] = useState(null);
  const [units, setUnits] = useState(null);
  const [note, setNote] = useState(null);
  const [custom, setCustom] = useState({ name: "", price: null });
  const groups = wholesale ? SALE_GROUPS.filter((item) => item.key !== "service") : SALE_GROUPS;

  function tell(message, tone = "warn") {
    setNote(message ? { tone, text: message } : null);
  }

  async function openGroup(next) {
    setGroup(next);
    setModel(null);
    setUnits(null);
    setModels(null);
    tell(null);
    if (next.key === "service") return;
    const result = await loadGroupModels(next.category);
    if (result?.ok) setModels(result.data);
    else tell(result?.error ?? "Modeller yüklenemedi.");
  }

  async function openModel(next) {
    if (!next.serialTracked) return tell(add.model(next) ?? `${next.name} sepete eklendi.`, "info");
    setModel(next);
    setUnits(null);
    const result = await loadModelUnits(next.productId);
    if (result?.ok) setUnits(result.data);
    else tell(result?.error ?? "Stok kayıtları yüklenemedi.");
  }

  async function scanned(scan) {
    tell(null);
    const result = await findSaleItemByCode(scanText(scan));
    if (!result?.ok) return tell(result?.error ?? "Okutulan kod aranamadı.");
    const found = result.data;
    if (found.kind === "unit") return tell(add.unit(found.unit) ?? `${found.unit.name} · ${found.unit.serial} sepete eklendi.`, "info");
    if (found.kind === "model") {
      const target = SALE_GROUPS.find((item) => item.category === found.category);
      if (target) await openGroup(target);
      return tell("Model bulundu; listeden stoktaki ürünü seçin.", "info");
    }
    tell(`${scan.serial ?? scan.raw ?? "Kod"} stokta bulunamadı.`);
  }

  function addCustom() {
    if (!custom.name.trim() || !(custom.price >= 0) || custom.price === null) return tell("İşlem adını ve ücretini yazın.");
    add.custom({ name: custom.name.trim(), price: custom.price });
    setCustom({ name: "", price: null });
    tell("Servis kalemi sepete eklendi.", "info");
  }

  const totals = cartTotals(lines, 0);
  const inCart = new Set(lines.map((line) => line.unitId).filter(Boolean));

  return (
    <div className="sale-step">
      <p className="sale-muted">Barkod okutun ya da ürün adı, barkod veya seri numarasıyla arayın. Ürün grubu seçmeden stokta aranır.</p>
      <ScanInput label="Barkod / seri no" onScan={scanned} autoFocus />
      {note && <p className={`sale-note ${note.tone}`} role="status">{note.text}</p>}

      <div className="sale-groups" role="group" aria-label="Elle ürün seçimi">
        {groups.map((item) => (
          <button key={item.key} type="button" className={group?.key === item.key ? "on" : undefined} aria-pressed={group?.key === item.key} onClick={() => openGroup(item)}>
            {item.label}
          </button>
        ))}
      </div>

      {group && group.key !== "service" && (
        <div className="sale-list">
          {models === null && <p className="sale-muted">Yükleniyor…</p>}
          {models?.length === 0 && <p className="sale-muted">Bu grupta stokta ürün yok.</p>}
          {models?.map((item) => (
            <button key={item.productId} type="button" className={`sale-row${model?.productId === item.productId ? " on" : ""}`} onClick={() => openModel(item)}>
              <span>
                <b>{item.name}</b>
                <small>{[item.type, `${item.inStock} stokta`, wholesale && "toptan fiyatla"].filter(Boolean).join(" · ")}</small>
              </span>
              <span className="sale-money">{formatMoney(wholesale ? item.wholesalePrice : item.salePrice)}</span>
            </button>
          ))}
        </div>
      )}

      {model && (
        <div className="sale-list">
          <h4>{model.name} · stoktaki kayıtlar</h4>
          {units === null && <p className="sale-muted">Yükleniyor…</p>}
          {units?.map((unit) => (
            <div key={unit.unitId} className="sale-row">
              <span>
                <b>{unit.serial ?? "Seri numarasız"}</b>
                <small>{{ right: "Sağ", left: "Sol", both: "İki kulak" }[unit.earSide] ?? "Taraf yok"}</small>
              </span>
              <button type="button" className="ui-button ui-button-ghost" disabled={inCart.has(unit.unitId)} onClick={() => tell(add.unit(unit) ?? `${unit.serial} sepete eklendi.`, "info")}>
                {inCart.has(unit.unitId) ? "Sepette" : "＋ Ekle"}
              </button>
            </div>
          ))}
        </div>
      )}

      {group?.key === "service" && (
        <div className="sale-list">
          {catalog.services.map((service) => (
            <button key={service.id} type="button" className="sale-row" onClick={() => tell(add.service(service) ?? `${service.name} sepete eklendi.`, "info")}>
              <span>
                <b>{service.name}</b>
                <small>{service.category === "audiology_exam" ? "Odyolojik muayene" : "Servis"}</small>
              </span>
              <span className="sale-money">{formatMoney(service.price)}</span>
            </button>
          ))}
          <div className="sale-custom">
            <label className="ui-field" htmlFor="sale-custom-name">
              <span className="ui-label">Listede olmayan servis kalemi</span>
              <input id="sale-custom-name" className="ui-input" maxLength={120} value={custom.name} onChange={(event) => setCustom((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <MoneyInput id="sale-custom-price" label="Ücret" defaultValue={null} onChange={(price) => setCustom((current) => ({ ...current, price }))} key={`c${lines.length}`} />
            <button type="button" className="ui-button ui-button-ghost" onClick={addCustom}>＋ Elle ekle</button>
          </div>
        </div>
      )}

      <div className="sale-bar">
        <span role="status">{lines.length ? `${lines.length} sepet kalemi · ${formatMoney(totals.total)}` : "Sepet boş"}</span>
        <button type="button" className="ui-button ui-button-primary" disabled={!lines.length} onClick={onNext}>
          Sepeti kontrol et →
        </button>
      </div>
    </div>
  );
}
