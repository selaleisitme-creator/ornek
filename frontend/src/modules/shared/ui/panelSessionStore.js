"use client";

import { useSyncExternalStore } from "react";

// The menu is drawn in the page's static shell, before the user is known; the permissions arrive a moment
// later from PanelSession (inside the layout's <Suspense>). A tiny shared store connects the two without
// moving the menu into the dynamic part. Until the data arrives, nothing restricted is shown.

const EMPTY = Object.freeze({ known: false, canViewAccounting: false, isAdmin: false });
let session = EMPTY;
const listeners = new Set();

export function setPanelSession(next) {
  session = Object.freeze({ known: true, ...next });
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePanelSession() {
  return useSyncExternalStore(subscribe, () => session, () => EMPTY);
}
