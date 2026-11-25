"use server";

import { refresh } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { toActionResult } from "@/modules/shared/server/actionResult";
import * as homeService from "./homeService";

// Thin gate for the home page. The two lists load when their window opens, so the page itself stays light.
// Interns may use all of these (plan 1.5.1); single sale amounts in the list are visible to them by design
// (plan 3.7), only the totals are hidden.

export async function loadSoldItems() {
  return toActionResult(async () => {
    await requireStaff();
    return homeService.getSoldItems();
  });
}

export async function loadArrivedVisits() {
  return toActionResult(async () => {
    await requireStaff();
    return homeService.getArrivedVisits();
  });
}

export async function saveReferralVisibility(changes) {
  return toActionResult(async () => {
    await requireStaff();
    await homeService.setReferralVisibility(changes);
    refresh();
  });
}

// FormData, because an uploaded logo only travels to a Server Action inside form data. Fields: name, preset, icon.
export async function addReferralSource(formData) {
  return toActionResult(async () => {
    await requireStaff();
    if (!(formData instanceof FormData)) throw new TypeError("Expected form data");
    const source = await homeService.addReferralSource({
      name: formData.get("name"),
      preset: formData.get("preset"),
      file: formData.get("icon"),
    });
    refresh();
    return source;
  });
}

export async function removeReferralSource(id) {
  return toActionResult(async () => {
    await requireStaff();
    await homeService.removeReferralSource(id);
    refresh();
  });
}
