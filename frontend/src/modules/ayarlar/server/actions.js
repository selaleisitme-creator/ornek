"use server";

import { refresh } from "next/cache";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { toActionResult } from "@/modules/shared/server/actionResult";
import * as settingsService from "./settingsService";
import * as accountService from "./accountService";
import * as usersService from "./usersService";
import { requireStepUp } from "@/lib/stepUp";

// Thin gate for the settings page: check who is asking, hand the work to the service, refresh the page.
// Shape for useActionState: (previous result, form data) → result.

// Clinic owner's rule: interns may change settings too, so any active staff member is enough here.
export async function saveGeneralSettings(_previous, form) {
  return toActionResult(async () => {
    await requireStaff();
    await settingsService.saveGeneralSettings(form);
    refresh();
  });
}

export async function saveWhatsAppNumber(_previous, form) {
  return toActionResult(async () => {
    await requireStaff();
    await settingsService.saveWhatsAppNumber(form);
    refresh();
  });
}

// Everyone changes only their own password: the Supabase client acts as the signed-in user.
export async function changePassword(_previous, form) {
  return toActionResult(async () => {
    await requireStaff();
    await accountService.changePassword(String(form.get("password") ?? ""), String(form.get("repeat") ?? ""));
  });
}

// User management: admin only, and the Authenticator code is asked again (step-up), because these
// actions decide who can see national IDs and accounting. Called with plain objects, not form data.
async function asAdminWithCode(work) {
  return toActionResult(async () => {
    const admin = await requireAdmin();
    await requireStepUp(admin.userId);
    await work(admin);
    refresh();
  });
}

export async function inviteUser(input) {
  return asAdminWithCode(() => usersService.inviteUser(input));
}

export async function updateUser(input) {
  return asAdminWithCode((admin) => usersService.updateUser(input, admin.userId));
}

export async function setUserActive(id, active) {
  return asAdminWithCode((admin) => usersService.setUserActive(id, active, admin.userId));
}

export async function resetUserTwoFactor(id) {
  return asAdminWithCode((admin) => usersService.resetTwoFactor(id, admin.userId));
}

export async function resendInvite(id) {
  return asAdminWithCode(() => usersService.resendInvite(id));
}

// The auto sign-out time stays with the admin (the database settings_guard enforces it as well).
export async function saveSecuritySettings(_previous, form) {
  return toActionResult(async () => {
    await requireAdmin();
    await settingsService.saveSecuritySettings(form);
    refresh();
  });
}
