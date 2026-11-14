import "server-only";
import { createClient } from "@/lib/supabase/server";

// The service price list (services) and when each price last changed (price_changes, written by the
// services trigger). Run as the signed-in user: staff may read, add and edit services; nobody deletes them.

function check({ data, error }) {
  if (error) throw error;
  return data ?? [];
}

const SERVICE_COLUMNS = "id, category, name, price, active, created_at";

// In the order they were added, which keeps the seeded list in the design's order.
export async function listActiveServices() {
  const supabase = await createClient();
  return check(await supabase.from("services").select(SERVICE_COLUMNS).eq("active", true).order("id"));
}

// Every price change of these services, newest first; the service keeps the first one per item.
export async function listServicePriceChanges(serviceIds) {
  if (!serviceIds.length) return [];
  const supabase = await createClient();
  return check(
    await supabase
      .from("price_changes")
      .select("service_id, changed_at")
      .in("service_id", serviceIds)
      .order("changed_at", { ascending: false })
  );
}

export async function getService(id) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("services").select(SERVICE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function insertService(values) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("services").insert(values).select("id").single();
  if (error) throw error;
  return data;
}

// Returns the updated row's id, or null when RLS or the filter matched nothing.
export async function updateActiveService(id, values) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .update(values)
    .eq("id", id)
    .eq("active", true)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return data;
}
