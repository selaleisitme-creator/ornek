import "server-only";
import { createClient } from "@/lib/supabase/server";

// Requests sent from the website's booking form. Read as the signed-in user: since 004 active staff may
// read them (RLS); the website itself writes with the secret key.

// How many requests still wait for an answer, and when the last one (of any status) arrived.
// Two small queries instead of loading the rows: only the count and one date are needed.
export async function getRequestSummary() {
  const supabase = await createClient();
  const [pending, latest] = await Promise.all([
    supabase.from("appointment_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
    supabase.from("appointment_requests").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (pending.error) throw pending.error;
  if (latest.error) throw latest.error;
  return { pendingCount: pending.count ?? 0, lastRequestAt: latest.data?.created_at ?? null };
}
