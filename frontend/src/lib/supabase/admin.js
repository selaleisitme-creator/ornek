import "server-only";
import { createClient } from "@supabase/supabase-js";

let client = null;

// Secret key bypasses RLS. "server-only" makes the build fail if this file reaches the browser.
export function getAdminClient() {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
