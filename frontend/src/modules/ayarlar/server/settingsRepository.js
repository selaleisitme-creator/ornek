import "server-only";
import { createClient } from "@/lib/supabase/server";

// The single settings row (id = 1), read and written as the signed-in user, so RLS and the
// settings_guard trigger decide what each person may change.

const COLUMNS =
  "whatsapp_number, maintenance_interval_months, reminders_enabled, remind_3d, remind_1d, remind_1h, idle_logout_minutes";

export async function getSettings() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select(COLUMNS).eq("id", 1).single();
  if (error) throw error;
  return data;
}

export async function getIdleLogoutMinutes() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("idle_logout_minutes").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data?.idle_logout_minutes ?? 30;
}

export async function updateSettings(changes) {
  const supabase = await createClient();
  // select() makes a silent RLS refusal visible: no row back means nothing was saved.
  const { data, error } = await supabase.from("settings").update(changes).eq("id", 1).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("settings update affected no rows");
}
