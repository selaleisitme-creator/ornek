// Pure rules for the Bağlantılar page: checking what people type into the link window, and the letter and
// colour a new link gets. Shared by the window (instant feedback) and the server (the real check).

// The four letter colours of the design's link tiles (son.html .lci.b / .g / .o / .p). Stored in links.color;
// the tile draws the letter in it on a pale tint of the same colour.
export const LINK_COLORS = ["#2a45a8", "#244d9c", "#a24a0b", "#6a34a3"];

// ÜTS, WSA, Kolaysoft and Medikal Merkez carry a system_key: the sale wizard and the home page's SGK card
// open them, so they can be renamed and re-addressed but never removed (decision 2026-11-21).
export function isSystemLink(link) {
  return Boolean(link?.system_key ?? link?.systemKey);
}

export const NAME_MAX = 60;
export const URL_MAX = 500;

// "kolaysoft.com.tr" → "https://kolaysoft.com.tr"; empty stays empty (a link may wait for its address).
export function normalizeUrl(input) {
  const text = String(input ?? "").trim();
  if (!text) return "";
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

// The first problem with the input, in Turkish, or null when it can be saved.
export function linkInputError({ name, url }) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) return "Bağlantının adını yazın.";
  if (cleanName.length > NAME_MAX) return `Ad en fazla ${NAME_MAX} karakter olabilir.`;

  const address = normalizeUrl(url);
  if (!address) return null;
  if (address.length > URL_MAX) return "Adres çok uzun.";
  let parsed;
  try {
    parsed = new URL(address);
  } catch {
    return "Geçerli bir web adresi yazın (ör. https://site.com).";
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes(".")) {
    return "Geçerli bir web adresi yazın (ör. https://site.com).";
  }
  return null;
}

// Tile letter: the name's first letter or digit, in Turkish capitals ("işitme" → "İ"); "@" when there is none.
export function linkLetter(name) {
  const first = String(name ?? "").trim().match(/[\p{L}\p{N}]/u)?.[0];
  return first ? first.toLocaleUpperCase("tr-TR") : "@";
}

// New links take the design colours in turn, so neighbouring tiles differ.
export function nextLinkColor(existingCount) {
  return LINK_COLORS[existingCount % LINK_COLORS.length];
}
