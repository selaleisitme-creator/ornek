// The password rule set in Supabase (Authentication > Email, 2026-11-09): at least 10 characters with a
// lowercase letter, an uppercase letter and a digit. Checked here first so people see which part is
// missing instead of Supabase's single "weak password" answer. Supabase still enforces it on its side.

export const PASSWORD_MIN_LENGTH = 10;

export const PASSWORD_RULES = [
  { test: (p) => p.length >= PASSWORD_MIN_LENGTH, text: `En az ${PASSWORD_MIN_LENGTH} karakter` },
  { test: (p) => /[a-zçğıöşü]/.test(p), text: "Bir küçük harf" },
  { test: (p) => /[A-ZÇĞİÖŞÜ]/.test(p), text: "Bir büyük harf" },
  { test: (p) => /\d/.test(p), text: "Bir rakam" },
];

// Returns the Turkish texts of the rules the password still misses ([] = acceptable).
export function missingPasswordRules(password) {
  return PASSWORD_RULES.filter((rule) => !rule.test(password ?? "")).map((rule) => rule.text);
}
