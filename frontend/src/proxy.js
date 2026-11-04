import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Pages a signed-out visitor may open. API routes answer with their own 401 instead of a redirect.
const PUBLIC_PATHS = ["/giris", "/sifre-yenile", "/auth", "/api"];

function isPublic(pathname) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

// Refreshes an expiring session and sends visitors without a fully verified session to /giris.
// It runs on every request, including moves between panel pages that do not re-run the layout.
// It is only the first gate: pages, API routes and RLS still check access themselves.
export async function proxy(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();

  // aal1 means the password was right but the 6-digit code was not entered yet;
  // /giris picks that session up again and asks for the code.
  if (data?.claims?.aal !== "aal2" && !isPublic(request.nextUrl.pathname)) {
    const redirect = NextResponse.redirect(new URL("/giris", request.url));
    // Keep any cookie changes (e.g. a cleared expired session) on the redirect response too.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:webp|png|jpg|svg|ico)$).*)"],
};
