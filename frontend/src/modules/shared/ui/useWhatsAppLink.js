"use client";

import { useSyncExternalStore } from "react";
import { whatsappLink } from "@/lib/whatsapp";

// Phones and tablets (a finger is the main pointer) get the app link; computers get WhatsApp Web.
// Read through useSyncExternalStore so the server render (no screen known) and the browser agree:
// the server draws the computer link, the browser switches to the app link on touch devices.
const QUERY = "(pointer: coarse)";

function subscribe(onChange) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useWhatsAppLink(phone, text = "") {
  const touch = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  return whatsappLink(phone, text, { web: !touch });
}
