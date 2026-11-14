"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProductEditDialog from "./ProductEditDialog";
import UnitEditDialog from "./UnitEditDialog";
import StockRemoveDialog from "./StockRemoveDialog";
import PriceUpdateDialog from "./PriceUpdateDialog";
import ServiceItemDialog from "./ServiceItemDialog";
import ConfirmDialog from "@/modules/shared/ui/ConfirmDialog";
import { useToast } from "@/modules/shared/ui/Toast";
import { removeServiceItem } from "../server/actions";

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

// "Fiyat güncelle" in the toolbar. The window loads the models itself when it opens.
export function PriceUpdateButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ui-button ui-button-ghost" onClick={() => setOpen(true)}>
        ₺ Fiyat güncelle
      </button>
      {open && <PriceUpdateDialog onClose={() => setOpen(false)} />}
    </>
  );
}

// "Kalem ekle" at the head of a service group.
export function ServiceAddButton({ category, categoryLabel }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ui-button ui-button-ghost" onClick={() => setOpen(true)}>
        ＋ Kalem ekle
      </button>
      {open && <ServiceItemDialog item={null} category={category} categoryLabel={categoryLabel} onClose={() => setOpen(false)} />}
    </>
  );
}

// "Düzenle" and "Kaldır" on a service item. Removing only hides it (active = false), so no code is asked.
export function ServiceItemActions({ item, categoryLabel }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const result = await removeServiceItem(item.id);
      if (result?.ok) toast(`${item.name} listeden kaldırıldı.`);
      else toast(result?.error ?? "Kalem kaldırılamadı.", "error");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <span className="stock-row-actions">
      <button type="button" className="stock-link-button" onClick={() => setEditing(true)} aria-label={`${item.name} düzenle`}>
        Düzenle
      </button>
      <button type="button" className="stock-link-button stock-link-danger" onClick={() => setConfirming(true)} aria-label={`${item.name} kaldır`}>
        Kaldır
      </button>
      {editing && <ServiceItemDialog item={item} categoryLabel={categoryLabel} onClose={() => setEditing(false)} />}
      {confirming && (
        <ConfirmDialog
          open
          title="Kalemi kaldır"
          message={`"${item.name}" servis listesinden kaldırılsın mı? Daha önceki satışlardaki kayıtlar değişmez.`}
          confirmLabel="Kaldır"
          danger
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
    </span>
  );
}
