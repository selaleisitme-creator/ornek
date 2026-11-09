// Money as the clinic writes it: "7.491,64" (dot for thousands, comma for kuruş).
// Amounts are parsed from text, never through float arithmetic, so 0,1 + 0,2 style errors cannot creep in.

const TL = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "7.491,64" → 7491.64, "20.000" → 20000, "12500,5 TL" → 12500.5. Returns null for anything that is not a
// valid amount, including more than two kuruş digits, so a typo never turns into a wrong price.
export function parseMoney(input) {
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) / 100 : null;
  if (typeof input !== "string") return null;

  const text = input.replace(/\s|TL|₺/gi, "");
  if (!/^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(,\d{1,2})?$/.test(text)) return null;

  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^-/, "").replace(/\./g, "").split(",");
  const kurus = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return (negative ? -kurus : kurus) / 100;
}

// 7491.64 → "7.491,64 TL". Numeric strings from the database ("7491.64") are accepted too.
export function formatMoney(value) {
  const amount = typeof value === "string" ? Number(value) : value;
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  return `${TL.format(amount)} TL`;
}

// For an input box: 7491.64 → "7.491,64" (no currency suffix).
export function formatMoneyInput(value) {
  const amount = typeof value === "string" ? Number(value) : value;
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "";
  return TL.format(amount);
}
