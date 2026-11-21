"use server";

import { requireStaff } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { toActionResult } from "@/modules/shared/server/actionResult";

export async function createAppointmentRequest(input) {
  return toActionResult(async () => {
    await requireStaff();

    const payload = {
      full_name: String(input.full_name ?? "").trim(),
      phone: String(input.phone ?? "").trim(),
      email: String(input.email ?? "").trim(),
      appointment_date: String(input.appointment_date ?? ""),
      appointment_time: String(input.appointment_time ?? ""),
      status: "new",
    };

    if (!payload.full_name || !payload.phone || !payload.email || !payload.appointment_date || !payload.appointment_time) {
      const error = new Error("Zorunlu randevu bilgileri eksik.");
      error.name = "ValidationError";
      throw error;
    }

    const { data, error } = await getAdminClient()
      .from("appointment_requests")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    const issue = String(input.issue ?? "").trim();
    if (issue && data?.id) {
      await getAdminClient()
        .from("appointment_requests")
        .update({ issue })
        .eq("id", data.id);
    }
    return data;
  });
}

export async function listAppointmentRequests() {
  return toActionResult(async () => {
    await requireStaff();
    const { data, error } = await getAdminClient()
      .from("appointment_requests")
      .select("*");
    if (error) throw error;
    return data || [];
  });
}

export async function setAppointmentRequestStatus(id, status) {
  return toActionResult(async () => {
    await requireStaff();
    if (!["new", "converted", "rejected"].includes(status)) {
      const error = new Error("Geçersiz randevu durumu.");
      error.name = "ValidationError";
      throw error;
    }

    const { data, error } = await getAdminClient()
      .from("appointment_requests")
      .update({ status })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return data;
  });
}
