"use client";

import Modal from "./Modal";

// "Are you sure?" for actions that cannot be taken back. `danger` paints the confirm button red.
export default function ConfirmDialog({ open, title, message, confirmLabel = "Onayla", danger, busy, onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="ui-button ui-button-ghost" onClick={onCancel} disabled={busy}>
            Vazgeç
          </button>
          <button
            type="button"
            className={`ui-button ${danger ? "ui-button-danger" : "ui-button-primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Bekleyin…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="ui-text">{message}</p>
    </Modal>
  );
}
