import "server-only";
import { createClient } from "@/lib/supabase/server";

// Links table reads and writes, made as the signed-in user so RLS (active staff) decides. Links are never
// deleted: removing one sets active = false (there is no delete rule on the table), so a mistake can be undone.

const COLUMNS = "id, name, url, icon_letter, color, sort_order, system_key";

export async function listActiveLinks() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("links").select(COLUMNS).eq("active", true).order("sort_order").order("id");
  if (error) throw error;
  return data ?? [];
}

export async function getLink(id) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("links").select(COLUMNS).eq("id", id).eq("active", true).maybeSingle();
  if (error) throw error;
  return data;
}

export async function maxSortOrder() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("links")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.sort_order ?? 0;
}

export async function insertLink(fields) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("links").insert(fields).select(COLUMNS).single();
  if (error) throw error;
  return data;
}

export async function updateLink(id, fields) {
  const supabase = await createClient();
  const { error } = await supabase.from("links").update(fields).eq("id", id);
  if (error) throw error;
}
