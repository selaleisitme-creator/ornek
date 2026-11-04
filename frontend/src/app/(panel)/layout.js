import { Suspense } from "react";
import PanelShell from "@/modules/shared/ui/PanelShell";
import { requirePanelProfile } from "@/lib/auth";

// viewport-fit=cover lets the phone menu read env(safe-area-inset-*) and stay clear of the
// iPhone home bar and notch. Set here, not in the root layout, so the login pages are unchanged.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Wraps every page in the (panel) group. The parentheses keep "(panel)" out of the URL.
export default function PanelLayout({ children }) {
  return (
    <PanelShell>
      <Suspense fallback={<p className="panel-loading">Yükleniyor…</p>}>
        <PanelAccess>{children}</PanelAccess>
      </Suspense>
    </PanelShell>
  );
}

// Reads the session cookie, so with Cache Components it must sit inside <Suspense>.
// Layouts do not re-run when moving between panel pages; proxy.js checks aal2 on every
// request and RLS protects the data itself, so this check only has to catch a fresh load.
async function PanelAccess({ children }) {
  await requirePanelProfile();
  return children;
}
