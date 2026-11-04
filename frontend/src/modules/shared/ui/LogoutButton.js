"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await createClient().auth.signOut();
    router.replace("/giris");
    router.refresh();
  }

  return (
    <button className="logout" type="button" onClick={logout} disabled={busy}>
      {busy ? "Çıkılıyor…" : "⇥ Çıkış"}
    </button>
  );
}
