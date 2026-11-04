import { createBrowserClient } from "@supabase/ssr";

// Browser client: keeps the session in cookies so server code can read the same session.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
