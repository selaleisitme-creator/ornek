"use client";

import { useState } from "react";
import StockEntryDialog from "./StockEntryDialog";

// "Stok ekle" button with its window. Used in the toolbar and in the empty search result, where a scanned
// barcode that is not in stock is passed on so a new model starts with that GTIN.
export default function StockEntryButton({ options, initialGtin = null, label = "＋ Stok ekle", ghost = false }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={`ui-button ${ghost ? "ui-button-ghost" : "ui-button-primary"}`} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <StockEntryDialog options={options} initialGtin={initialGtin} onClose={() => setOpen(false)} />}
    </>
  );
}
