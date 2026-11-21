"use client";

import { useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import ConfirmDialog from "@/modules/shared/ui/ConfirmDialog";
import { useToast } from "@/modules/shared/ui/Toast";
import { addReferralSource, removeReferralSource, saveReferralVisibility } from "../server/actions";

// "Kaynakları seç": tick which sources the table shows (shared by everyone), add a new one, or remove one.
// Removing only hides it (active = false); old appointments keep their source.
export default function ReferralSourcePicker({ sources }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState({});
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(null);

  function start() {
    setPicked(Object.fromEntries(sources.map((source) => [source.id, source.visible])));
    setName("");
    setError(null);
    setOpen(true);
  }

  async function save() {
    const changes = sources
      .filter((source) => picked[source.id] !== source.visible)
      .map((source) => ({ id: source.id, visible: picked[source.id] }));
    if (!changes.length) return setOpen(false);
    setBusy(true);
    const result = await saveReferralVisibility(changes);
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "Kaydedilemedi.");
    toast("Kaynak seçimi kaydedildi.");
    setOpen(false);
  }

  async function add(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await addReferralSource(name);
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "Kaynak eklenemedi.");
    setPicked((current) => ({ ...current, [result.data.id]: true }));
    setName("");
    toast(`"${result.data.name}" eklendi.`);
  }

  async function confirmRemove() {
    setBusy(true);
    const result = await removeReferralSource(removing.id);
    setBusy(false);
    if (!result?.ok) setError(result?.error ?? "Kaynak kaldırılamadı.");
    else toast(`"${removing.name}" kaldırıldı.`);
    setRemoving(null);
  }

  return (
    <>
      <button type="button" className="home-source-tool" onClick={start}>
        Kaynakları seç
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Randevu kaynakları"
        title="Kaynakları seç"
        footer={
          <>
            <button type="button" className="ui-button ui-button-ghost" onClick={() => setOpen(false)}>
              Vazgeç
            </button>
            <button type="button" className="ui-button ui-button-primary" onClick={save} disabled={busy}>
              {busy ? "Bekleyin…" : "Seçimi kaydet"}
            </button>
          </>
        }
      >
        <div className="home-source-manager">
          <p className="home-history-hint">İşaretli kaynaklar tabloda görünür. Seçim bütün kullanıcılar için ortaktır.</p>
          <ul className="home-source-grid">
            {sources.map((source) => (
              <li key={source.id} className="home-source-item">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(picked[source.id])}
                    onChange={(event) => setPicked((current) => ({ ...current, [source.id]: event.target.checked }))}
                  />
                  <span className={`home-source-icon ${source.icon.tone}`} aria-hidden="true">{source.icon.mark}</span>
                  <b>{source.name}</b>
                </label>
                <button type="button" className="home-source-remove" onClick={() => setRemoving(source)} disabled={busy}>
                  Kaldır
                </button>
              </li>
            ))}
          </ul>
          <form className="home-source-add" onSubmit={add}>
            <label className="ui-visually-hidden" htmlFor="home-source-name">Yeni kaynak adı</label>
            <input
              id="home-source-name"
              className="ui-input"
              placeholder="Yeni kaynak adı (ör. TikTok, Tavsiye)"
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit" className="ui-button ui-button-ghost" disabled={busy || !name.trim()}>
              ＋ Ekle
            </button>
          </form>
          {error && <p className="ui-error" role="alert">{error}</p>}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Kaynağı kaldır"
        message={removing ? `"${removing.name}" listeden ve seçim kutularından kalkar. Eski randevular kaynağını korur.` : ""}
        confirmLabel="Kaldır"
        danger
        busy={busy}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
