import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";

// User administration needs the secret key: auth.users (e-mail, last sign-in, two-step factors) is not
// reachable with a user's session, and invitations are an admin API. Only usersService calls this file,
// and only after requireAdmin() + the step-up code.

const PROFILE_COLUMNS =
  "id, full_name, role, active, access_until, can_view_national_id, can_view_accounting, created_at";

function check({ data, error }) {
  if (error) throw error;
  return data;
}

export async function listProfiles() {
  return check(await getAdminClient().from("profiles").select(PROFILE_COLUMNS).order("created_at"));
}

export async function getProfile(id) {
  return check(await getAdminClient().from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle());
}

export async function countActiveAdmins() {
  const { count, error } = await getAdminClient()
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("active", true);
  if (error) throw error;
  return count ?? 0;
}

export async function insertProfile(row) {
  check(await getAdminClient().from("profiles").insert(row));
}

export async function updateProfile(id, changes) {
  check(await getAdminClient().from("profiles").update(changes).eq("id", id));
}

// The clinic has a handful of accounts; one page of 1000 covers them all.
export async function listAuthUsers() {
  return check(await getAdminClient().auth.admin.listUsers({ page: 1, perPage: 1000 })).users;
}

// The user list from listUsers() does not carry the two-step factors, so each user's factors are asked for
// separately (a handful of accounts, in parallel). Returns the ids that have a verified authenticator.
export async function listUserIdsWithTwoFactor(userIds) {
  const admin = getAdminClient();
  const results = await Promise.all(
    userIds.map(async (userId) => {
      const factors = check(await admin.auth.admin.mfa.listFactors({ userId })).factors;
      return factors.some((f) => f.factor_type === "totp" && f.status === "verified") ? userId : null;
    })
  );
  return new Set(results.filter(Boolean));
}

export async function getAuthUser(id) {
  return check(await getAdminClient().auth.admin.getUserById(id)).user;
}

// Supabase creates the account and sends the "Invite user" e-mail through the clinic's SMTP.
export async function inviteAuthUser(email) {
  return check(await getAdminClient().auth.admin.inviteUserByEmail(email)).user;
}

// Only used to undo an invitation whose profile row could not be written, so no half-made account remains.
export async function deleteAuthUser(id) {
  check(await getAdminClient().auth.admin.deleteUser(id));
}

export async function deleteTwoFactor(userId) {
  const admin = getAdminClient();
  const factors = check(await admin.auth.admin.mfa.listFactors({ userId }));
  for (const factor of factors.factors.filter((f) => f.factor_type === "totp")) {
    check(await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId }));
  }
  // Old backup codes belong to the removed authenticator; new ones are made at the next setup.
  check(await admin.from("mfa_recovery_codes").delete().eq("user_id", userId));
}
