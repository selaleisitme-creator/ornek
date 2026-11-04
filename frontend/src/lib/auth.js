import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";

// getClaims() verifies the token signature, unlike getSession() which trusts the cookie as-is.
export async function getCurrentClaims() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return data.claims;
}

// Profiles are only readable at aal2 through RLS, so the access check before the code step uses the secret key.
export async function hasPanelAccess(userId) {
  const { data, error } = await getAdminClient()
    .from("profiles")
    .select("active")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.active);
}
