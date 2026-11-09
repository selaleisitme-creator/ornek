import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClaims } from "@/lib/auth";
import { authMessage } from "@/lib/authMessages";
import { missingPasswordRules } from "@/lib/passwordRules";
import { ValidationError } from "./settingsService";

// "Hesabım": what the signed-in user can see and change about their own account.

// Read from the signed session token (the same claims every page already checks), not from extra calls
// to Supabase: those could fail while the session was being refreshed, and the card then showed "—".
// Anyone who can see this page has passed the 6-digit code (aal2), so two-step is on by definition.
export async function getAccountInfo() {
  const claims = await getCurrentClaims();
  return {
    email: claims?.email ?? null,
    twoFactorActive: claims?.aal === "aal2",
  };
}

export async function changePassword(password, repeat) {
  const missing = missingPasswordRules(password);
  if (missing.length) throw new ValidationError(`Şifrede eksik: ${missing.join(", ").toLocaleLowerCase("tr")}.`);
  if (password !== repeat) throw new ValidationError("İki şifre birbiriyle aynı değil.");

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new ValidationError(authMessage(error));
}
