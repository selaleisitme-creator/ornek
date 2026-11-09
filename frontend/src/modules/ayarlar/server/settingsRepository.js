import "server-only";
import { createClient } from "@/lib/supabase/server";

// Reads the single settings row as the signed-in user (RLS: active staff may read it).
export async function getIdleLogoutMinutes() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("settings").select("idle_logout_minutes").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data?.idle_logout_minutes ?? 30;
}
