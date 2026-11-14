"use client";

import { useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import MoneyInput from "@/modules/shared/ui/MoneyInput";
import { useToast } from "@/modules/shared/ui/Toast";
import { buildServiceItem } from "../stockRules";
import { saveServiceItem } from "../server/actions";

// Add a service item to a group (item null, category given) or change an item's name and price. A price
// change is logged by the database, which is where "Son fiyat güncellemesi" comes from.
export default function ServiceItemDialog({ item, category, categoryLabel, onClose }) {
  const toast = useToast();
  const isNew = !item;
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(item?.price ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(event) {
    event.preventDefault();
    const input = { id: item?.id ?? null, category, name, price };
    const built = buildServiceItem(input, { isNew });
    if (built.error) return setError(built.error);
    setBusy(true);
    setError(null);
    try {
      const result = await saveServiceItem(input);
      if (result?.ok) {
        toast(isNew ? `${built.values.name} eklendi.` : `${built.values.name} güncellendi.`);
        onClose();
      } else {
        setError(result?.error ?? "Kalem kaydedilemedi.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={`Servis · ${categoryLabel}`}
      title={isNew ? "Kalem ekle" : "Kalemi düzenle"}
      size="sm"
      footer={
        <>
          {error && <p className="ui-error stock-entry-error" role="alert">{error}</p>}
          <button type="button" className="ui-button ui-button-ghost" onClick={onClose} disabled={busy}>Vazgeç</button>
          <button type="submit" form="service-item-form" className="ui-button ui-button-primary" disabled={busy}>
            {busy ? "Bekleyin…" : "Kaydet"}
          </button>
        </>
      }
    >
      <form id="service-item-form" className="ui-stack" onSubmit={save} noValidate>
        <label className="ui-field" htmlFor="service-item-name">
          <span className="ui-label">Kalem adı</span>
          <input
            id="service-item-name"
            className="ui-input"
            maxLength={120}
            required
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <MoneyInput id="service-item-price" label="Fiyat (KDV dahil)" defaultValue={item?.price} required onChange={setPrice} />
      </form>
    </Modal>
  );
}
