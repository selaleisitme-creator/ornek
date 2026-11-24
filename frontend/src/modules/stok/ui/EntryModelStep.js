"use client";

import MoneyInput from "@/modules/shared/ui/MoneyInput";
import { formatMoney } from "@/lib/money";
import { SERIAL_POLICIES, serialPolicyLabel, stockGroupByCategory } from "../stockRules";
import { addBrand } from "../server/actions";
import PickOrAdd from "./PickOrAdd";

function TextField({ id, label, value, onChange, ...rest }) {
  return (
    <label className="ui-field" htmlFor={id}>
      <span className="ui-label">{label}</span>
      <input id={id} className="ui-input" value={value ?? ""} onChange={(event) => onChange(event.target.value)} {...rest} />
    </label>
  );
}

function NewModelForm({ draft, setDraft, brands, onBrandAdded }) {
  const set = (key) => (value) => setDraft((current) => ({ ...current, [key]: value }));
  const battery = draft.category === "battery";

  return (
    <div className="stock-entry-grid">
      {/* Devices got their brand in step 1; accessories pick it here, because their list is not split by brand. */}
      {draft.category !== "device" && (
        <div className="stock-entry-wide">
          <PickOrAdd
            id="entry-model-brand"
            label="Marka"
            options={brands}
            value={draft.brandId}
            onChange={set("brandId")}
            onAdd={addBrand}
            onAdded={onBrandAdded}
            addLabel="Yeni marka ekle"
            placeholder="Marka adı"
            required
          />
        </div>
      )}
      <TextField id="entry-name" label="Model adı" value={draft.name} onChange={set("name")} maxLength={120} required />
      <TextField id="entry-type" label="Tip / varyant (isteğe bağlı)" value={draft.type} onChange={set("type")} maxLength={120} />
      <MoneyInput id="entry-sale-price" label="Satış fiyatı" defaultValue={draft.salePrice} onChange={set("salePrice")} required />
      <MoneyInput
        id="entry-wholesale-price"
        label="Toptan satış fiyatı"
        defaultValue={draft.wholesalePrice}
        onChange={set("wholesalePrice")}
        required
      />
      <TextField id="entry-gtin" label="GTIN (isteğe bağlı)" value={draft.gtin} onChange={set("gtin")} inputMode="numeric" maxLength={20} />
      <TextField id="entry-package" label="Ambalaj barkodu (isteğe bağlı)" value={draft.packageBarcode} onChange={set("packageBarcode")} maxLength={60} />
      <TextField id="entry-ref" label="Üretici REF (isteğe bağlı)" value={draft.manufacturerRef} onChange={set("manufacturerRef")} maxLength={60} />
      <TextField id="entry-warranty" label="Garanti (ay)" type="number" min={0} step={1} value={draft.warrantyMonths} onChange={set("warrantyMonths")} />
      <TextField id="entry-min-stock" label="Alt stok eşiği" type="number" min={0} step={1} value={draft.minStock} onChange={set("minStock")} />
      <label className="ui-field" htmlFor="entry-serial-policy">
        <span className="ui-label">Seri numarası</span>
        <select id="entry-serial-policy" className="ui-input" value={draft.serialPolicy} onChange={(event) => set("serialPolicy")(event.target.value)}>
          {SERIAL_POLICIES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      {battery && (
        <>
          <TextField id="entry-pack-size" label="Paket içi pil adedi" type="number" min={1} step={1} value={draft.packSize} onChange={set("packSize")} required />
          <TextField id="entry-packs-per-box" label="Kutudaki paket (isteğe bağlı)" type="number" min={1} step={1} value={draft.packsPerBox} onChange={set("packsPerBox")} />
          <TextField id="entry-boxes-per-carton" label="Kolideki kutu (isteğe bağlı)" type="number" min={1} step={1} value={draft.boxesPerCarton} onChange={set("boxesPerCarton")} />
        </>
      )}
    </div>
  );
}

// Step 2 as in the design: "Bernafon · Model seçimi", a dashed "＋ Yeni model oluştur" card, then the
// existing models as two-column cards. A model card moves on at once; the new-model card opens the form.
export default function EntryModelStep({ title, category, models, choice, onChoice, draft, setDraft, brands, onBrandAdded }) {
  const unitWord = stockGroupByCategory(category).unitWord;

  return (
    <div className="stock-entry-step">
      <header className="stock-entry-step-head">
        <h3>{title} · Model seçimi</h3>
        <p>Mevcut bir modeli seçerseniz adı, tipi ve fiyatı otomatik gelir.</p>
      </header>

      <button
        type="button"
        className={`stock-new-model${choice === "new" ? " on" : ""}`}
        aria-expanded={choice === "new"}
        onClick={() => onChoice("new")}
      >
        <b>＋ Yeni model oluştur</b>
        <small>İlk kez kaydedilecek ürün</small>
      </button>

      {choice === "new" && draft && <NewModelForm draft={draft} setDraft={setDraft} brands={brands} onBrandAdded={onBrandAdded} />}

      {models.length > 0 ? (
        <ul className="stock-model-cards" aria-label="Kayıtlı modeller">
          {models.map((model) => (
            <li key={model.id}>
              <button type="button" className="stock-model-card" onClick={() => onChoice(model.id)}>
                <b>
                  {category !== "device" && <span className="stock-model-card-brand">{model.brandName} · </span>}
                  {model.name}
                </b>
                <small>
                  {model.type || stockGroupByCategory(category).label} · {formatMoney(model.salePrice)} · Seri no: {serialPolicyLabel(model.serialPolicy)}
                </small>
                <span className="stock-model-card-count">
                  {model.inStock} {unitWord} →
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="stock-muted">Bu grupta kayıtlı model yok; yukarıdan yeni model oluşturun.</p>
      )}
    </div>
  );
}
