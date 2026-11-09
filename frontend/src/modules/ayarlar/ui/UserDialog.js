"use client";

import { useState } from "react";
import Modal from "@/modules/shared/ui/Modal";

const ROLE_OPTIONS = [
  { value: "intern", label: "Stajyer" },
  { value: "staff", label: "Personel" },
  { value: "admin", label: "Yönetici" },
];

// Invite (user is null) or edit (user given). No password field: the invited person sets their own
// password from the e-mail link, so nobody else ever knows it.
export default function UserDialog({ open, user, busy, error, onSubmit, onClose }) {
  const editing = Boolean(user);
  const [form, setForm] = useState(() => ({
    fullName: user?.fullName ?? "",
    email: user?.email ?? "",
    role: user?.role ?? "intern",
    accessUntil: user?.accessUntil ?? "",
    canViewNationalId: user?.canViewNationalId ?? false,
    canViewAccounting: user?.canViewAccounting ?? false,
  }));
  const intern = form.role === "intern";
  const set = (key) => (event) =>
    setForm((current) => ({
      ...current,
      [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
    }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Kullanıcılar"
      title={editing ? `${user.fullName} · düzenle` : "Kullanıcı davet et"}
      footer={
        <>
          <button type="button" className="ui-button ui-button-ghost" onClick={onClose} disabled={busy}>Vazgeç</button>
          <button type="submit" form="user-form" className="ui-button ui-button-primary" disabled={busy}>
            {busy ? "Kaydediliyor…" : editing ? "Kaydet" : "Davet gönder"}
          </button>
        </>
      }
    >
      <form
        id="user-form"
        className="ui-stack"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ ...form, id: user?.id, canViewNationalId: !intern && form.canViewNationalId, canViewAccounting: !intern && form.canViewAccounting });
        }}
      >
        <div className="settings-form-grid">
          <label className="ui-field">
            <span className="ui-label">Ad soyad</span>
            <input className="ui-input" value={form.fullName} onChange={set("fullName")} required minLength={2} maxLength={80} />
          </label>
          <label className="ui-field">
            <span className="ui-label">E-posta</span>
            <input className="ui-input" type="email" value={form.email} onChange={set("email")} required disabled={editing} />
          </label>
          <label className="ui-field">
            <span className="ui-label">Rol</span>
            <select className="ui-input" value={form.role} onChange={set("role")}>
              {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="ui-field">
            <span className="ui-label">Erişim bitiş tarihi{intern ? "" : " (isteğe bağlı)"}</span>
            <input className="ui-input" type="date" value={form.accessUntil} onChange={set("accessUntil")} required={intern} />
          </label>
        </div>

        <fieldset className="settings-checks">
          <legend className="ui-label">İzinler</legend>
          <label>
            <input type="checkbox" checked={!intern && form.canViewNationalId} onChange={set("canViewNationalId")} disabled={intern} />
            TC numaralarını görebilir
          </label>
          <label>
            <input type="checkbox" checked={!intern && form.canViewAccounting} onChange={set("canViewAccounting")} disabled={intern} />
            Muhasebeyi görebilir
          </label>
          {intern && <span className="settings-hint">Stajyerler TC numaralarını ve muhasebeyi hiçbir zaman göremez.</span>}
        </fieldset>

        {!editing && (
          <p className="settings-hint" style={{ margin: 0 }}>
            Kişiye &ldquo;Şelale İşitme&rdquo; adıyla bir davet e-postası gider. Bağlantı 1 saat geçerlidir; kişi şifresini
            kendisi belirler ve ilk girişte Authenticator&apos;ı kurar.
          </p>
        )}
        {error && <p className="ui-error" role="alert" style={{ margin: 0 }}>{error}</p>}
      </form>
    </Modal>
  );
}
