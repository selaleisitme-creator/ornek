"use server";

import { requireStaff } from "@/lib/auth";
import { verifyStepUpCode } from "@/lib/stepUp";
import { toActionResult } from "./actionResult";

// Called by StepUpDialog through useActionState: (previous result, form data) → new result.
export async function confirmStepUp(_previous, formData) {
  const result = await toActionResult(async () => {
    const staff = await requireStaff();
    return { confirmed: await verifyStepUpCode(staff.userId, String(formData.get("code") ?? "")) };
  });
  if (result.ok && !result.data.confirmed) {
    return { ok: false, error: "Kod doğrulanamadı. Uygulamadaki güncel kodu girin." };
  }
  return result;
}
