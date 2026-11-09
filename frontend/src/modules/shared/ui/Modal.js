"use client";

import { useEffect, useRef } from "react";

// Built on the browser's own <dialog>: showModal() traps focus inside, Escape closes it and the page
// behind becomes inert, so none of that has to be hand-written. On phones the CSS turns it into a
// bottom sheet.
export default function Modal({ open, onClose, title, eyebrow, children, footer, size = "md" }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`ui-modal ui-modal-${size}`}
      aria-labelledby="ui-modal-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the dimmed area (the dialog element itself, outside the panel) closes it.
        if (event.target === ref.current) onClose?.();
      }}
    >
      <div className="ui-modal-panel">
        <header className="ui-modal-head">
          <div>
            {eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}
            <h2 id="ui-modal-title">{title}</h2>
          </div>
          <button type="button" className="ui-icon-button" aria-label="Kapat" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer && <footer className="ui-modal-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}
