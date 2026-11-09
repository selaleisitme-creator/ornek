// Phone numbers are stored in international form ("+905321234567") so WhatsApp links and searches work
// the same for every patient. The country list is the one in the approved design.

export const COUNTRY_CODES = [
  { code: "+90", label: "Türkiye" },
  { code: "+49", label: "Almanya" },
  { code: "+44", label: "Birleşik Krallık" },
  { code: "+1", label: "ABD / Kanada" },
  { code: "+33", label: "Fransa" },
  { code: "+31", label: "Hollanda" },
  { code: "+32", label: "Belçika" },
  { code: "+43", label: "Avusturya" },
  { code: "+41", label: "İsviçre" },
  { code: "+994", label: "Azerbaycan" },
  { code: "+995", label: "Gürcistan" },
  { code: "+359", label: "Bulgaristan" },
  { code: "+30", label: "Yunanistan" },
];

// ("+90", "0532 123 45 67") → "+905321234567". The national trunk "0" is dropped, as when dialling from abroad.
// Returns null when the result cannot be a real number (E.164 allows at most 15 digits).
export function normalizePhone(countryCode, localNumber) {
  const country = (countryCode ?? "").replace(/[^\d]/g, "");
  let local = (localNumber ?? "").replace(/[^\d]/g, "");
  if (!country || !local) return null;
  if (local.startsWith(country) && local.length > 10) local = local.slice(country.length);
  local = local.replace(/^0+/, "");

  if (country === "90" && !/^\d{10}$/.test(local)) return null;
  const digits = country + local;
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

// "+905321234567" → "+90 532 123 45 67" for Turkish numbers; others are shown as stored.
export function formatPhone(phone) {
  if (!phone) return "—";
  const match = /^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return match ? `+90 ${match[1]} ${match[2]} ${match[3]} ${match[4]}` : phone;
}
