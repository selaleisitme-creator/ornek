"use client";

import { STOCK_GROUPS } from "../stockRules";
import { addBrand } from "../server/actions";
import PickOrAdd from "./PickOrAdd";

// Step 1: which group, and for hearing aids which brand (devices are listed brand by brand).
export default function EntryGroupStep({ category, onCategory, brandId, onBrand, brands, onBrandAdded }) {
  return (
    <div className="ui-stack">
      <fieldset className="stock-entry-choices">
        <legend className="ui-label">Ürün grubu</legend>
        {STOCK_GROUPS.map((group) => (
          <button
            key={group.key}
            type="button"
            className={`stock-entry-choice${category === group.category ? " on" : ""}`}
            aria-pressed={category === group.category}
            onClick={() => onCategory(group.category)}
          >
            {group.label}
          </button>
        ))}
      </fieldset>

      {category === "device" && (
        <PickOrAdd
          id="entry-device-brand"
          label="Marka"
          options={brands}
          value={brandId}
          onChange={onBrand}
          onAdd={addBrand}
          onAdded={onBrandAdded}
          addLabel="Yeni marka ekle"
          placeholder="Marka adı"
          required
        />
      )}
    </div>
  );
}
