"use client";

import { useActionState, useState } from "react";
import PasswordInput from "@/components/PasswordInput";
import ConfirmDialog from "@/modules/shared/ui/ConfirmDialog";
import StatusBadge from "@/modules/shared/ui/StatusBadge";
import { useToast } from "@/modules/shared/ui/Toast";
import { PASSWORD_RULES } from "@/lib/passwordRules";
import { changePassword } from "../server/actions";
import { useResultToast } from "./useResultToast";

const ROLE_LABELS = { admin: "Yönetici", staff: "Personel", intern: "Stajyer" };

// "Hesabım": own password, own backup codes, two-step status. Every user has this card.
export default function AccountCard({ email, role, twoFactorActive }) {
  const [result, submit, pending] = useActionState(changePassword, null);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  useResultToast(result, "Şifreniz değiştirildi.");

  // Empty the boxes only after a successful change; after an error the typed password stays to fix.
  // Done while rendering (React's "adjust state when a value changes" pattern) rather than in an effect,
  // so the boxes never show the old password for one extra frame.
  const [handledResult, setHandledResult] = useState(null);
  if (result !== handledResult) {
    setHandledResult(result);
    if (result?.ok) {
      setPassword("");
      setRepeat("");
    }
  }

  return (
    <section className="settings-card">
      <header>
        <h2>Hesabım</h2>
        <p>Yalnızca kendi hesabınızı etkiler.</p>
      </header>

      <dl className="settings-facts">
        <dt>E-posta</dt>
        <dd>{email ?? "—"}</dd>
        <dt>Rol</dt>
        <dd>{ROLE_LABELS[role] ?? role}</dd>
        <dt>İki adımlı doğrulama</dt>
        <dd>{twoFactorActive ? <StatusBadge tone="ok">Açık</StatusBadge> : <StatusBadge tone="danger">Kurulmamış</StatusBadge>}</dd>
      </dl>

      <form action={submit} className="ui-stack">
        <h3 className="ui-label">Şifre değiştir</h3>
        <ul className="settings-muted" style={{ margin: 0, paddingLeft: 18 }}>
          {PASSWORD_RULES.map((rule) => (
            <li key={rule.text} style={{ color: rule.test(password) ? "var(--ui-ok)" : undefined }}>{rule.text}</li>
          ))}
        </ul>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="new-password">Yeni şifre</label>
          <PasswordInput id="new-password" value={password} onChange={setPassword} autoComplete="new-password" />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="repeat-password">Yeni şifre (tekrar)</label>
          <PasswordInput id="repeat-password" value={repeat} onChange={setRepeat} autoComplete="new-password" />
        </div>
        <input type="hidden" name="password" value={password} />
        <input type="hidden" name="repeat" value={repeat} />
        <footer style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" className="ui-button ui-button-primary" disabled={pending || !password}>
            {pending ? "Kaydediliyor…" : "Şifreyi değiştir"}
          </button>
        </footer>
      </form>

      <RecoveryCodes />
    </section>
  );
}

// New backup codes through the existing login API (it also checks aal2 and panel access).
// The old codes stop working at once, so it asks first, and the new ones are shown only this time.
function RecoveryCodes() {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState(null);

  async function create() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/recovery-codes", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error);
      setCodes(body.codes);
      setAsking(false);
    } catch (error) {
      toast(error.message || "Yedek kodlar oluşturulamadı.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-stack">
      <h3 className="ui-label">Yedek kodlar</h3>
      <p className="settings-muted" style={{ margin: 0 }}>
        Telefonunuz kaybolursa giriş için kullanılır. Yeni kodlar oluşturunca eskiler hemen geçersiz olur.
      </p>
      {codes ? (
        <>
          <ul className="settings-codes">
            {codes.map((code) => <li key={code}>{code}</li>)}
          </ul>
          <p className="ui-error" style={{ margin: 0 }}>
            Bu kodlar bir daha gösterilmez. Yazıp güvenli bir yerde saklayın; telefona fotoğraf olarak kaydetmeyin.
          </p>
        </>
      ) : (
        <div>
          <button type="button" className="ui-button ui-button-ghost" onClick={() => setAsking(true)}>
            Yeni yedek kodlar oluştur
          </button>
        </div>
      )}
      <ConfirmDialog
        open={asking}
        title="Yeni yedek kodlar oluşturulsun mu?"
        message="Elinizdeki eski yedek kodlar hemen geçersiz olur."
        confirmLabel="Oluştur"
        busy={busy}
        onConfirm={create}
        onCancel={() => setAsking(false)}
      />
    </div>
  );
}
