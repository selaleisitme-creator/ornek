"use client";

import { createContext, useCallback, useContext, useState } from "react";

// Short confirmations such as "Stok eklendi." Mounted once in PanelShell; any client component calls
// useToast()("Mesaj") or useToast()("Hata", "error"). Messages disappear after a few seconds and are read
// out by screen readers (aria-live).
const ToastContext = createContext(() => {});
const SHOW_MS = 4000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const show = useCallback((message, tone = "success") => {
    const id = crypto.randomUUID();
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), SHOW_MS);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="ui-toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`ui-toast ui-toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
