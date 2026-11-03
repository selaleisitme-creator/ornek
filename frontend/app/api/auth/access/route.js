import { getCurrentClaims, hasPanelAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Called right after the password step: a correct password alone is not enough, the account
// also needs an active profile. Otherwise the session is closed immediately.
export async function POST() {
  const claims = await getCurrentClaims();
  if (!claims) {
    return Response.json({ error: "Oturum bulunamadı." }, { status: 401 });
  }

  if (!(await hasPanelAccess(claims.sub))) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    return Response.json({ error: "Bu hesabın panele giriş yetkisi yok." }, { status: 403 });
  }

  return Response.json({ ok: true });
}
