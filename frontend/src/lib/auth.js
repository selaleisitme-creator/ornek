import "server-only";
import { io } from "next/cache";
import { redirect } from "next/navigation";
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

// Panel pages call this. The profile is read as the user, so RLS only returns it at aal2;
// an inactive account is sent back to /giris, where the access check signs it out.
export async function requirePanelProfile() {
  // getClaims() compares the token expiry with the current time (Date.now()). io() tells Next.js
  // this check belongs to the real request, so it never runs while a page shell is prerendered.
  await io();
  const claims = await getCurrentClaims();
  if (!claims || claims.aal !== "aal2") redirect("/giris");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, active")
    .eq("id", claims.sub)
    .maybeSingle();
  if (!profile?.active) redirect("/giris");

  return profile;
}
