import "server-only";
import { todayInClinic } from "@/lib/dates";
import { ValidationError } from "./settingsService";
import * as repo from "./usersRepository";

// Rules for managing panel users (admin only; the action checks the role and the step-up code first).
// The database adds its own guards (interns never get national ID or accounting permission, only an admin
// may change roles), but the reasons are explained here in words people understand.

const ROLES = ["admin", "staff", "intern"];

function cleanInput(input, { creating }) {
  const fullName = String(input?.fullName ?? "").trim();
  if (fullName.length < 2 || fullName.length > 80) throw new ValidationError("Ad soyad 2–80 karakter olmalı.");

  const role = String(input?.role ?? "");
  if (!ROLES.includes(role)) throw new ValidationError("Geçerli bir rol seçin.");

  const accessUntil = String(input?.accessUntil ?? "").trim() || null;
  if (accessUntil && !/^\d{4}-\d{2}-\d{2}$/.test(accessUntil)) throw new ValidationError("Erişim bitiş tarihi geçersiz.");
  // Interns are temporary by definition: without an end date someone would have to remember to close them.
  if (role === "intern" && !accessUntil) throw new ValidationError("Stajyer için erişim bitiş tarihi girin.");
  if (creating && accessUntil && accessUntil < todayInClinic()) {
    throw new ValidationError("Erişim bitiş tarihi bugünden önce olamaz.");
  }

  const intern = role === "intern";
  const cleaned = {
    full_name: fullName,
    role,
    access_until: accessUntil,
    // Clinic owner's rule: interns never see national IDs or accounting, whatever the form says.
    can_view_national_id: intern ? false : Boolean(input?.canViewNationalId),
    can_view_accounting: intern ? false : Boolean(input?.canViewAccounting),
  };

  if (creating) {
    const email = String(input?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Geçerli bir e-posta adresi girin.");
    cleaned.email = email;
  }
  return cleaned;
}

// The admin may not lock the panel out: the last active admin cannot be demoted or closed.
async function assertAdminRemains(target, next) {
  const losesAdmin = target.role === "admin" && target.active && (next.role !== "admin" || next.active === false);
  if (losesAdmin && (await repo.countActiveAdmins()) <= 1) {
    throw new ValidationError("Panelde en az bir aktif yönetici kalmalı.");
  }
}

export async function listUsers() {
  const [profiles, authUsers] = await Promise.all([repo.listProfiles(), repo.listAuthUsers()]);
  const byId = new Map(authUsers.map((user) => [user.id, user]));
  const withTwoFactor = await repo.listUserIdsWithTwoFactor(profiles.map((profile) => profile.id));
  const today = todayInClinic();

  return profiles.map((profile) => {
    const auth = byId.get(profile.id);
    const expired = Boolean(profile.access_until && profile.access_until < today);
    const invited = !auth?.last_sign_in_at;
    return {
      id: profile.id,
      fullName: profile.full_name,
      email: auth?.email ?? null,
      role: profile.role,
      active: profile.active,
      accessUntil: profile.access_until,
      canViewNationalId: profile.can_view_national_id,
      canViewAccounting: profile.can_view_accounting,
      lastSignInAt: auth?.last_sign_in_at ?? null,
      twoFactor: withTwoFactor.has(profile.id),
      status: !profile.active ? "closed" : expired ? "expired" : invited ? "invited" : "active",
    };
  });
}

export async function inviteUser(input) {
  const { email, ...profile } = cleanInput(input, { creating: true });

  const existing = (await repo.listAuthUsers()).find((user) => user.email?.toLowerCase() === email);
  if (existing) throw new ValidationError("Bu e-posta adresiyle bir kullanıcı zaten var.");

  const user = await repo.inviteAuthUser(email);
  try {
    await repo.insertProfile({ id: user.id, active: true, ...profile });
  } catch (error) {
    await repo.deleteAuthUser(user.id); // no account without a profile
    throw error;
  }
}

export async function updateUser(input, actorId) {
  const id = String(input?.id ?? "");
  const target = await repo.getProfile(id);
  if (!target) throw new ValidationError("Kullanıcı bulunamadı.");

  const next = cleanInput(input, { creating: false });
  if (id === actorId && next.role !== target.role) throw new ValidationError("Kendi rolünüzü değiştiremezsiniz.");
  await assertAdminRemains(target, { role: next.role, active: target.active });
  await repo.updateProfile(id, next);
}

export async function setUserActive(id, active, actorId) {
  const target = await repo.getProfile(String(id ?? ""));
  if (!target) throw new ValidationError("Kullanıcı bulunamadı.");
  if (target.id === actorId && !active) throw new ValidationError("Kendi erişiminizi kapatamazsınız.");
  await assertAdminRemains(target, { role: target.role, active: Boolean(active) });
  await repo.updateProfile(target.id, { active: Boolean(active) });
}

// Lost phone: the user sets up the authenticator again at the next sign-in.
export async function resetTwoFactor(id, actorId) {
  const target = await repo.getProfile(String(id ?? ""));
  if (!target) throw new ValidationError("Kullanıcı bulunamadı.");
  if (target.id === actorId) {
    throw new ValidationError("Kendi doğrulamanızı buradan sıfırlayamazsınız; giriş ekranındaki yedek kodu kullanın.");
  }
  await repo.deleteTwoFactor(target.id);
}

export async function resendInvite(id) {
  const auth = await repo.getAuthUser(String(id ?? ""));
  if (!auth) throw new ValidationError("Kullanıcı bulunamadı.");
  if (auth.last_sign_in_at) throw new ValidationError("Bu kullanıcı zaten giriş yapmış; davete gerek yok.");
  await repo.inviteAuthUser(auth.email);
}
