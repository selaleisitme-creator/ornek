import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Landing page of the invitation e-mail. The Supabase "Invite user" template links here with a one-time
// token_hash; verifyOtp turns it into a session cookie, and the person continues on /sifre-yenile to set
// their own password. After that, the login page runs the usual Authenticator setup.
// (The password reset e-mail keeps using /auth/callback; that flow is unchanged.)
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // Only invitations come through here, so other token types are refused rather than handled half-way.
  if (tokenHash && type === "invite") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}/sifre-yenile`);
  }

  return NextResponse.redirect(`${origin}/giris?link=gecersiz`);
}
