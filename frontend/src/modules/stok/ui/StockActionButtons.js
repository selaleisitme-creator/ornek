"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProductEditDialog from "./ProductEditDialog";
import UnitEditDialog from "./UnitEditDialog";
import StockRemoveDialog from "./StockRemoveDialog";

// Small client islands for the stock list: a button and the window it opens. The list itself stays a Server
// Component, so only these buttons and their windows ship JavaScript. Each window is mounted only while
// open, so every opening starts from the current server values.

// "Düzenle" on a model row. The edit fields and photos are loaded for the open model only; on another row
// the button first opens that model (?ac=) and the window appears once its details arrive.
export function ModelEditButton({ model, details, openHref, serialLessCount = 0 }) {
  const router = useRouter();
  const [wanted, setWanted] = useState(false);

  function click() {
    setWanted(true);
    if (!details) router.push(openHref, { scroll: false });
  }

  return (
    <>
      <button type="button" className="stock-link-button" onClick={click} aria-label={`${model.brandName} ${model.name} düzenle`}>
        Düzenle
      </button>
      {wanted && details && (
        <ProductEditDialog
          details={details}
          brandName={model.brandName}
          inStock={model.inStock}
          serialLessCount={serialLessCount}
          onClose={() => setWanted(false)}
        />
      )}
    </>
  );
}

export function UnitEditButton({ unit, model }) {
  const [open, setOpen] = useState(false);
  const label = unit.serialNo ?? `${unit.count} adet`;
  return (
    <>
      <button type="button" className="stock-link-button" onClick={() => setOpen(true)} aria-label={`${label} düzenle`}>
        Düzenle
      </button>
      {open && <UnitEditDialog unit={unit} model={model} onClose={() => setOpen(false)} />}
    </>
  );
}

// "Stok sil" above the open model's units and in the toolbar. Without an open model there is nothing to
// pick from, so the toolbar button stays disabled and says why.
export function StockRemoveButton({ model, units, ghost = true }) {
  const [open, setOpen] = useState(false);
  const disabled = !model || !units?.length;
  const hint = !model ? "Önce bir modelin kayıtlarını açın." : !units?.length ? "Bu modelin stokta birimi yok." : undefined;
  return (
    <>
      <button
        type="button"
        className={`ui-button ${ghost ? "ui-button-ghost" : "ui-button-danger"}`}
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={hint}
      >
        Stok sil
      </button>
      {open && model && <StockRemoveDialog model={model} units={units} onClose={() => setOpen(false)} />}
    </>
  );
}
