// The panel never sends WhatsApp messages itself: it opens a draft and a person presses send.
// Two kinds of link, because they behave differently:
//   wa.me                     phones: opens the WhatsApp app. On a computer it shows a page that offers the
//                             desktop app first, which is why it seemed to "send you to the app".
//   web.whatsapp.com/send     computers: opens the chat straight in WhatsApp Web in the browser.
// Numbers are digits only, with the country code.

export function whatsappLink(phone, text = "", { web = false } = {}) {
  const digits = (phone ?? "").replace(/[^\d]/g, "");
  if (!digits) return null;

  if (web) {
    const query = new URLSearchParams({ phone: digits });
    if (text) query.set("text", text);
    return `https://web.whatsapp.com/send?${query.toString().replace(/\+/g, "%20")}`;
  }

  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${query}`;
}
