import { getCurrentClaims, hasPanelAccess } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { generateCodes, hashCode } from "@/lib/recoveryCodes";

// Creates a fresh set of backup codes. Only a fully verified (aal2) session may do this,
// otherwise someone with just the password could mint codes and skip the phone step.
export async function POST() {
  const claims = await getCurrentClaims();
  if (!claims || claims.aal !== "aal2") {
    return Response.json({ error: "Önce doğrulama kodunu girin." }, { status: 401 });
  }
  if (!(await hasPanelAccess(claims.sub))) {
    return Response.json({ error: "Bu hesabın panele giriş yetkisi yok." }, { status: 403 });
  }

  const admin = getAdminClient();
  const codes = generateCodes();
  const rows = await Promise.all(
    codes.map(async (code) => ({ user_id: claims.sub, code_hash: await hashCode(code) }))
  );

  // Old codes stop working as soon as a new set exists.
  const removed = await admin.from("mfa_recovery_codes").delete().eq("user_id", claims.sub);
  if (removed.error) throw removed.error;
  const inserted = await admin.from("mfa_recovery_codes").insert(rows);
  if (inserted.error) throw inserted.error;

  return Response.json({ codes }, { headers: { "Cache-Control": "no-store" } });
}
