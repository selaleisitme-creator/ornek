// The clinic works on Istanbul time, wherever the server runs (Vercel runs on UTC).
// Server code that calls these during render must call `await io()` (next/cache) first: reading the clock
// is request-time work under Cache Components.

export const CLINIC_TIME_ZONE = "Europe/Istanbul";

function parts(date, options) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: CLINIC_TIME_ZONE, ...options })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
}

// Today's date in Istanbul as "2026-11-09", the format Postgres `date` columns use.
export function todayInClinic(now = new Date()) {
  const p = parts(now, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

// "2026-11-09" or a Date → "09.11.2026".
export function formatDate(value) {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}.${month}.${year}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const p = parts(date, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.day}.${p.month}.${p.year}`;
}

// A timestamp → "09.11.2026 14:30" in Istanbul time.
export function formatDateTime(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const p = parts(date, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

// "09.11.2026" (what people type) → "2026-11-09", or null if it is not a real date.
export function parseDisplayDate(text) {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((text ?? "").trim());
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
