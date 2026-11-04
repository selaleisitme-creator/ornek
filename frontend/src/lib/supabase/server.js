import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Acts as the signed-in user, so database rules (RLS) still apply.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components cannot write cookies; proxy.js refreshes the session instead.
          }
        },
      },
    }
  );
}
