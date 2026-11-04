import { getCurrentClaims, hasPanelAccess } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { matchesHash, normalizeCode } from "@/lib/recoveryCodes";

// Lost phone: a valid backup code removes the old authenticator so the user can set up a new one.
// Supabase signs the user out of every session when a verified factor is deleted, so the client
// signs in again with the password and then goes through setup.
export async function POST(request) {
  const claims = await getCurrentClaims();
  if (!claims) {
    return Response.json({ error: "Oturum süresi doldu. Yeniden giriş yapın." }, { status: 401 });
  }
  if (!(await hasPanelAccess(claims.sub))) {
    return Response.json({ error: "Bu hesabın panele giriş yetkisi yok." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const code = normalizeCode(body.code);
  if (code.length !== 8) {
    return Response.json({ error: "Yedek kod XXXX-XXXX biçiminde olmalı." }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data: unused, error } = await admin
    .from("mfa_recovery_codes")
    .select("id, code_hash")
    .eq("user_id", claims.sub)
    .is("used_at", null);
  if (error) throw error;

  let matchId = null;
  for (const row of unused) {
    if (await matchesHash(code, row.code_hash)) {
      matchId = row.id;
      break;
    }
  }
  if (!matchId) {
    return Response.json({ error: "Kod geçersiz ya da daha önce kullanılmış." }, { status: 400 });
  }

  // used_at filter in the update stops two parallel requests from spending the same code twice.
  const spent = await admin
    .from("mfa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", matchId)
    .is("used_at", null)
    .select("id");
  if (spent.error) throw spent.error;
  if (spent.data.length === 0) {
    return Response.json({ error: "Kod geçersiz ya da daha önce kullanılmış." }, { status: 400 });
  }

  const factors = await admin.auth.admin.mfa.listFactors({ userId: claims.sub });
  if (factors.error) throw factors.error;
  for (const factor of factors.data.factors.filter((f) => f.factor_type === "totp")) {
    const deleted = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: claims.sub });
    if (deleted.error) throw deleted.error;
  }

  return Response.json({ ok: true });
}
