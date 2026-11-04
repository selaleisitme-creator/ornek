import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The password reset e-mail lands here with a one-time code; it is swapped for a session cookie.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/sifre-yenile`);
  }

  return NextResponse.redirect(`${origin}/giris?link=gecersiz`);
}
