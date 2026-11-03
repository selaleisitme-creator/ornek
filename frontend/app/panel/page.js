import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentClaims } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "./LogoutButton";

export const metadata = { title: "Panel | Şelale İşitme" };

// Placeholder until the real panel is built; its job now is to prove the guard works.
export default function PanelPage() {
  return (
    <main className="panel-placeholder">
      <Suspense fallback={<p className="intro">Yükleniyor…</p>}>
        <Welcome />
      </Suspense>
    </main>
  );
}

// Reads the session cookie, so with Cache Components it must render inside <Suspense>.
async function Welcome() {
  const claims = await getCurrentClaims();
  if (!claims || claims.aal !== "aal2") redirect("/giris");

  // Read as the user: RLS returns the row only for an active admin with a verified code.
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, active")
    .eq("id", claims.sub)
    .maybeSingle();
  if (!profile?.active) redirect("/giris");

  return (
    <div className="login auth-card">
      <p className="auth-eyebrow">Yönetim paneli</p>
      <h1>Hoş geldin, {profile.full_name}</h1>
      <p className="intro">Giriş ve iki adımlı doğrulama çalışıyor. Panel sayfaları bir sonraki aşamada buraya gelecek.</p>
      <LogoutButton />
    </div>
  );
}
