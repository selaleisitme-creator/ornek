"use server";

import { refresh } from "next/cache";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { toActionResult } from "@/modules/shared/server/actionResult";
import * as settingsService from "./settingsService";

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

// The auto sign-out time stays with the admin (the database settings_guard enforces it as well).
export async function saveSecuritySettings(_previous, form) {
  return toActionResult(async () => {
    await requireAdmin();
    await settingsService.saveSecuritySettings(form);
    refresh();
  });
}
