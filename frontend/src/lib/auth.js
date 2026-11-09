import "server-only";
import { cache } from "react";
import { io } from "next/cache";
import { todayInClinic } from "@/lib/dates";
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
// An account whose access end date has passed (a finished internship) is refused here too, so it is signed
// out at the password step instead of reaching the panel's "access ended" screen. (Added 2026-11-09.)
export async function hasPanelAccess(userId) {
  const { data, error } = await getAdminClient()
    .from("profiles")
    .select("active, access_until")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.active) return false;
  return !data.access_until || data.access_until >= todayInClinic();
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

// ---------------------------------------------------------------------------
// Permissions for pages and Server Actions (added in Faz 0; the login functions above are unchanged)
// ---------------------------------------------------------------------------

// Thrown by the require* helpers. Server Actions are reachable by direct POST requests, so every action
// starts with one of them; hiding a button is never the protection.
export class AccessDeniedError extends Error {
  constructor(message = "Access denied") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

// The signed-in user's panel permissions, read as the user (RLS applies). null means no panel access:
// not signed in, code step not done, inactive, or the access end date has passed.
// cache() runs it once per request even when several components ask.
export const getStaffProfile = cache(async () => {
  await io();
  const claims = await getCurrentClaims();
  if (!claims || claims.aal !== "aal2") return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, role, active, access_until, can_view_national_id, can_view_accounting")
    .eq("id", claims.sub)
    .maybeSingle();
  if (error) throw error;
  if (!data?.active) return null;
  if (data.access_until && data.access_until < todayInClinic()) return null;

  return {
    userId: claims.sub,
    sessionId: claims.session_id,
    fullName: data.full_name,
    role: data.role,
    isAdmin: data.role === "admin",
    canViewNationalId: data.can_view_national_id,
    canViewAccounting: data.can_view_accounting,
  };
});

export async function requireStaff() {
  const staff = await getStaffProfile();
  if (!staff) throw new AccessDeniedError("No panel access");
  return staff;
}

export async function requireAccounting() {
  const staff = await requireStaff();
  if (!staff.canViewAccounting) throw new AccessDeniedError("No accounting permission");
  return staff;
}

export async function requireAdmin() {
  const staff = await requireStaff();
  if (!staff.isAdmin) throw new AccessDeniedError("Admin only");
  return staff;
}
