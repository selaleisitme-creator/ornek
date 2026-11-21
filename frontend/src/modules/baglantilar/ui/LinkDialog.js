"use client";

import { useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import ConfirmDialog from "@/modules/shared/ui/ConfirmDialog";
import { useToast } from "@/modules/shared/ui/Toast";
import { NAME_MAX, URL_MAX, isSystemLink, linkInputError } from "../linkRules";
import { addLink, editLink, removeLink } from "../server/actions";

// "Bağlantı ekle" / "Bağlantıyı düzenle": the design's two fields, name and web address. The address may stay
// empty (the tile then shows "Adres ekle"). System links have no "Sil": the sale wizard and SGK card use them.
export default function LinkDialog({ link, open, onClose }) {
  const toast = useToast();
  const [name, setName] = useState(link?.name ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const system = isSystemLink(link);

  async function save(event) {
    event?.preventDefault();
    const problem = linkInputError({ name, url });
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const result = link ? await editLink(link.id, { name, url }) : await addLink({ name, url });
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "Kaydedilemedi.");
    toast(link ? "Bağlantı kaydedildi." : "Bağlantı eklendi.");
    onClose();
  }

  async function remove() {
    setBusy(true);
    const result = await removeLink(link.id);
    setBusy(false);
    setConfirming(false);
    if (!result?.ok) return setError(result?.error ?? "Silinemedi.");
    toast(`"${link.name}" silindi.`);
    onClose();
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        eyebrow="Bağlantılar"
        title={link ? "Bağlantıyı düzenle" : "Bağlantı ekle"}
        footer={
          <div className="links-dialog-foot">
            {link && !system && (
              <button type="button" className="links-remove" onClick={() => setConfirming(true)} disabled={busy}>
                Sil
              </button>
            )}
            <button type="button" className="ui-button ui-button-ghost" onClick={onClose}>
              Vazgeç
            </button>
            <button type="submit" form="links-form" className="ui-button ui-button-primary" disabled={busy}>
              {busy ? "Bekleyin…" : "Kaydet"}
            </button>
          </div>
        }
      >
        <form id="links-form" className="links-form" onSubmit={save} noValidate>
          <label className="ui-field" htmlFor="links-name">
            <span className="ui-label">Ad</span>
            <input
              id="links-name"
              className="ui-input"
              value={name}
              maxLength={NAME_MAX}
              autoComplete="off"
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="ui-field" htmlFor="links-url">
            <span className="ui-label">Web adresi</span>
            <input
              id="links-url"
              className="ui-input"
              type="url"
              inputMode="url"
              placeholder="https://…"
              value={url}
              maxLength={URL_MAX}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          {system && (
            <p className="links-note">Bu bağlantı satış ve SGK adımlarında kullanıldığı için silinemez; adı ve adresi değiştirilebilir.</p>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={confirming}
        title="Bağlantıyı sil"
        message={link ? `"${link.name}" bağlantılardan kaldırılır.` : ""}
        confirmLabel="Sil"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
