// The panel never sends WhatsApp messages itself: it opens a draft and a person presses send.
// wa.me needs the number as digits only, with the country code.

export function whatsappLink(phone, text = "") {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${query}`;
}
