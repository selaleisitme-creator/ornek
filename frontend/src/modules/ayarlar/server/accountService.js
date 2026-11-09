import "server-only";
import { createClient } from "@/lib/supabase/server";
import { authMessage } from "@/lib/authMessages";
import { missingPasswordRules } from "@/lib/passwordRules";
import { ValidationError } from "./settingsService";

// "Hesabım": what the signed-in user can see and change about their own account.

export async function getAccountInfo() {
  const supabase = await createClient();
  const [{ data: user }, { data: factors }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.mfa.listFactors(),
  ]);
  return {
    email: user?.user?.email ?? null,
    twoFactorActive: Boolean(factors?.totp?.some((factor) => factor.status === "verified")),
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
