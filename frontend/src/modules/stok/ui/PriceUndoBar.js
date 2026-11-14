"use client";

import { useState } from "react";
import ConfirmDialog from "@/modules/shared/ui/ConfirmDialog";
import { useToast } from "@/modules/shared/ui/Toast";
import { useStepUpAction } from "@/modules/shared/ui/useStepUpAction";
import { undoLastPriceBatch } from "../server/actions";

// The last bulk price change above the list, with "Geri al": confirm, then the 6-digit code. All or nothing
// (undo_price_batch, 008): if a price was changed again since, nothing is restored and the reason is shown.
export default function PriceUndoBar({ batchId, label, count }) {
  const toast = useToast();
  const { run, stepUpDialog } = useStepUpAction();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function undo() {
    // The confirm window closes first, so the code window is the only one on screen.
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const result = await run(undoLastPriceBatch, batchId);
      if (result?.ok) toast(`${result.data?.restored ?? count} fiyat eski değerine döndü.`);
      else if (!result?.cancelled) setError(result?.error ?? "Fiyatlar geri alınamadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stock-price-bar" role="region" aria-label="Son fiyat güncellemesi">
      <p className="stock-price-bar-text">{label}</p>
      <button type="button" className="ui-button ui-button-ghost" onClick={() => setConfirming(true)} disabled={busy}>
        {busy ? "Bekleyin…" : "Geri al"}
      </button>
      {error && <p className="ui-error stock-price-bar-error" role="alert">{error}</p>}
      <ConfirmDialog
        open={confirming}
        title="Fiyat güncellemesini geri al"
        message={`Bu işlemdeki ${count} modelin satış fiyatı eski değerine döner. Fiyatı sonradan yeniden değişen bir model varsa hiçbiri döndürülmez. 6 haneli kodunuz istenir.`}
        confirmLabel="Geri al"
        onConfirm={undo}
        onCancel={() => setConfirming(false)}
      />
      {stepUpDialog}
    </div>
  );
}
