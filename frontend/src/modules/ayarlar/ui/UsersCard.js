"use client";

import { useState } from "react";
import DataTable from "@/modules/shared/ui/DataTable";
import StatusBadge from "@/modules/shared/ui/StatusBadge";
import ConfirmDialog from "@/modules/shared/ui/ConfirmDialog";
import { useToast } from "@/modules/shared/ui/Toast";
import { useStepUpAction } from "@/modules/shared/ui/useStepUpAction";
import { formatDate, formatDateTime } from "@/lib/dates";
import { inviteUser, resendInvite, resetUserTwoFactor, setUserActive, updateUser } from "../server/actions";
import UserDialog from "./UserDialog";

const ROLE_LABELS = { admin: "Yönetici", staff: "Personel", intern: "Stajyer" };
const STATUS = {
  active: { tone: "ok", text: "Aktif" },
  invited: { tone: "info", text: "Davet bekliyor" },
  expired: { tone: "warn", text: "Süresi doldu" },
  closed: { tone: "neutral", text: "Kapalı" },
};

// Admin-only list of panel users with invite, edit, close/open access, two-step reset and invite resend.
// Every change goes through useStepUpAction: the server asks for the Authenticator code if it is not fresh.
export default function UsersCard({ users, currentUserId }) {
  const toast = useToast();
  const { run, stepUpDialog } = useStepUpAction();
  const [dialog, setDialog] = useState(null); // { user } — user null = invite
  const [confirm, setConfirm] = useState(null); // { title, message, label, danger, action, args, done }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function execute(action, args, doneMessage) {
    setBusy(true);
    setError(null);
    try {
      const result = await run(action, ...args);
      if (result?.ok) {
        toast(doneMessage);
        return true;
      }
      if (!result?.cancelled) setError(result?.error ?? "İşlem tamamlanamadı.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDialog(values) {
    const ok = dialog.user
      ? await execute(updateUser, [values], "Kullanıcı güncellendi.")
      : await execute(inviteUser, [values], "Davet e-postası gönderildi.");
    if (ok) setDialog(null);
  }

  async function confirmAction() {
    const ok = await execute(confirm.action, confirm.args, confirm.done);
    if (ok) setConfirm(null);
  }

  const ask = (props) => {
    setError(null);
    setConfirm(props);
  };

  const columns = [
    {
      key: "fullName",
      label: "Kullanıcı",
      render: (u) => (
        <>
          <strong>{u.fullName}</strong>
          {u.id === currentUserId && <span className="settings-muted"> (siz)</span>}
          <div className="settings-muted">{u.email ?? "—"}</div>
        </>
      ),
    },
    { key: "role", label: "Rol", render: (u) => ROLE_LABELS[u.role] ?? u.role },
    { key: "status", label: "Durum", render: (u) => <StatusBadge tone={STATUS[u.status].tone}>{STATUS[u.status].text}</StatusBadge> },
    {
      key: "twoFactor",
      label: "İki adımlı",
      render: (u) => (u.twoFactor ? <StatusBadge tone="ok">Kurulu</StatusBadge> : <StatusBadge tone="neutral">Yok</StatusBadge>),
    },
    { key: "lastSignInAt", label: "Son giriş", render: (u) => formatDateTime(u.lastSignInAt) },
    { key: "accessUntil", label: "Erişim bitişi", render: (u) => (u.accessUntil ? formatDate(u.accessUntil) : "Süresiz") },
    {
      key: "actions",
      label: "İşlemler",
      render: (u) => (
        <div className="settings-row-actions">
          <button type="button" className="ui-button ui-button-ghost" onClick={() => { setError(null); setDialog({ user: u }); }}>
            Düzenle
          </button>
          {u.status === "invited" && (
            <button type="button" className="ui-button ui-button-ghost"
              onClick={() => ask({ title: "Davet yeniden gönderilsin mi?", message: `${u.email} adresine yeni bir davet e-postası gider.`, label: "Gönder", action: resendInvite, args: [u.id], done: "Davet yeniden gönderildi." })}>
              Daveti yeniden gönder
            </button>
          )}
          {u.twoFactor && u.id !== currentUserId && (
            <button type="button" className="ui-button ui-button-ghost"
              onClick={() => ask({ title: "İki adımlı doğrulama sıfırlansın mı?", message: `${u.fullName} bir sonraki girişte Authenticator'ı yeniden kurar. Telefonu kaybolan kişi için kullanın.`, label: "Sıfırla", danger: true, action: resetUserTwoFactor, args: [u.id], done: "İki adımlı doğrulama sıfırlandı." })}>
              2FA sıfırla
            </button>
          )}
          {u.id !== currentUserId && (
            u.active ? (
              <button type="button" className="ui-button ui-button-ghost"
                onClick={() => ask({ title: "Erişim kapatılsın mı?", message: `${u.fullName} panele hemen erişemez; açık oturumu da veri göremez. Girdiği kayıtlar silinmez.`, label: "Erişimi kapat", danger: true, action: setUserActive, args: [u.id, false], done: "Erişim kapatıldı." })}>
                Erişimi kapat
              </button>
            ) : (
              <button type="button" className="ui-button ui-button-ghost"
                onClick={() => ask({ title: "Erişim yeniden açılsın mı?", message: `${u.fullName} panele yeniden girebilir.`, label: "Erişimi aç", action: setUserActive, args: [u.id, true], done: "Erişim açıldı." })}>
                Erişimi aç
              </button>
            )
          )}
        </div>
      ),
    },
  ];

  return (
    <section className="settings-card settings-wide">
      <header className="settings-users-head">
        <div>
          <h2>Kullanıcılar</h2>
          <p>Yalnızca yönetici görür. Değişikliklerde Authenticator kodu yeniden sorulur.</p>
        </div>
        <button type="button" className="ui-button ui-button-primary" onClick={() => { setError(null); setDialog({ user: null }); }}>
          ＋ Kullanıcı davet et
        </button>
      </header>

      <DataTable columns={columns} rows={users} caption="Panel kullanıcıları" empty="Henüz kullanıcı yok." />

      {dialog && (
        <UserDialog
          key={dialog.user?.id ?? "new"}
          open
          user={dialog.user}
          busy={busy}
          error={error}
          onSubmit={saveDialog}
          onClose={() => setDialog(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        message={error ? `${confirm?.message} — ${error}` : confirm?.message}
        confirmLabel={confirm?.label}
        danger={confirm?.danger}
        busy={busy}
        onConfirm={confirmAction}
        onCancel={() => setConfirm(null)}
      />
      {stepUpDialog}
    </section>
  );
}
