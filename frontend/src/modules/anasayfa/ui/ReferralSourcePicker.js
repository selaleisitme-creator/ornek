"use client";
/* eslint-disable @next/next/no-img-element -- 22 px logos from public/ or a local preview blob; next/image adds nothing here */

import { useEffect, useRef, useState } from "react";
import Modal from "@/modules/shared/ui/Modal";
import ConfirmDialog from "@/modules/shared/ui/ConfirmDialog";
import { useToast } from "@/modules/shared/ui/Toast";
import { SOURCE_PRESETS } from "../homeRules";
import { addReferralSource, removeReferralSource, saveReferralVisibility } from "../server/actions";
import { IconError, resizeIcon } from "./resizeIcon";
import SourceIcon from "./SourceIcon";

// "Gösterilecek kaynaklar" (son.html): tick which sources the table shows (shared by everyone), delete one, or add a
// new one with a logo: one of the drawn marks in public/source-icons, or a picture uploaded from the computer.
// Deleting only hides the source (active = false); old appointments keep it.
export default function ReferralSourcePicker({ sources }) {
  const toast = useToast();
  const fileInput = useRef(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState({});
  const [name, setName] = useState("");
  const [logo, setLogo] = useState(null); // { preset, label } or { file, url }
  const [gallery, setGallery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(null);

  // The preview of an uploaded picture is a blob: URL; it is released when the choice changes.
  useEffect(() => () => logo?.url && URL.revokeObjectURL(logo.url), [logo]);

  function resetNew() {
    setName("");
    setLogo(null);
    setGallery(false);
  }

  function start() {
    setPicked(Object.fromEntries(sources.map((source) => [source.id, source.visible])));
    resetNew();
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

  function choosePreset(preset) {
    setLogo({ preset: preset.key, label: preset.label });
    if (!name.trim()) setName(preset.label);
    setGallery(false);
    setError(null);
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const small = await resizeIcon(file);
      setLogo({ file: small, url: URL.createObjectURL(small) });
      setGallery(false);
      setError(null);
    } catch (problem) {
      setError(problem instanceof IconError ? problem.message : "Logo hazırlanamadı.");
    }
  }

  async function add(event) {
    event.preventDefault();
    if (!logo) return setError("Kaynağı eklemeden önce bir simge seçin ya da logo yükleyin.");
    const form = new FormData();
    form.set("name", name);
    if (logo.preset) form.set("preset", logo.preset);
    if (logo.file) form.set("icon", logo.file);
    setBusy(true);
    setError(null);
    const result = await addReferralSource(form);
    setBusy(false);
    if (!result?.ok) return setError(result?.error ?? "Kaynak eklenemedi.");
    setPicked((current) => ({ ...current, [result.data.id]: true }));
    resetNew();
    toast(`"${result.data.name}" eklendi.`);
  }

  async function confirmRemove() {
    setBusy(true);
    const result = await removeReferralSource(removing.id);
    setBusy(false);
    if (!result?.ok) setError(result?.error ?? "Kaynak silinemedi.");
    else toast(`"${removing.name}" silindi.`);
    setRemoving(null);
  }

  const logoText = logo?.preset ? `${logo.label} simgesi seçildi` : logo?.file ? "Bilgisayardan logo seçildi" : "Henüz logo seçilmedi";

  return (
    <>
      <button type="button" className="home-source-tool" onClick={start}>
        Kaynakları seç
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="Randevu kaynakları"
        title="Gösterilecek kaynaklar"
        size="lg"
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
          <p className="home-history-hint">Tabloda görünmesini istediğiniz kaynakları seçin veya kullanmadığınız kaynağı silin.</p>
          <ul className="home-source-grid">
            {sources.map((source) => (
              <li key={source.id} className="home-source-item">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(picked[source.id])}
                    onChange={(event) => setPicked((current) => ({ ...current, [source.id]: event.target.checked }))}
                  />
                  <SourceIcon icon={source.icon} />
                  <b>{source.name}</b>
                </label>
                <button type="button" className="home-source-remove" onClick={() => setRemoving(source)} disabled={busy}>
                  Sil
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
            <button type="button" className="ui-button ui-button-ghost" aria-expanded={gallery} onClick={() => setGallery((value) => !value)}>
              ＋ Simge ekle
            </button>
            <span className="home-source-chosen" aria-live="polite">
              {logo?.preset && <img src={`/source-icons/${logo.preset}.svg`} alt="" width={22} height={22} />}
              {logo?.url && <img src={logo.url} alt="" width={22} height={22} />}
              {logoText}
            </span>
            <button type="submit" className="ui-button ui-button-primary" disabled={busy || !name.trim() || !logo}>
              Kaynağı ekle
            </button>
          </form>

          {gallery && (
            <div className="home-source-gallery" role="group" aria-label="Platform simgeleri">
              {SOURCE_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={`home-source-preset${logo?.preset === preset.key ? " on" : ""}`}
                  aria-pressed={logo?.preset === preset.key}
                  onClick={() => choosePreset(preset)}
                >
                  <img src={`/source-icons/${preset.key}.svg`} alt="" width={22} height={22} />
                  {preset.label}
                </button>
              ))}
              <button type="button" className="home-source-preset home-source-upload" onClick={() => fileInput.current?.click()}>
                <span aria-hidden="true">＋</span>
                Bilgisayardan logo yükle
              </button>
              <input ref={fileInput} type="file" accept="image/png,image/webp,image/jpeg" hidden onChange={chooseFile} />
            </div>
          )}

          <p className="home-history-hint">Kaynağı eklemeden önce platform simgesi seçin veya bilgisayarınızdan logo yükleyin.</p>
          {error && <p className="ui-error" role="alert">{error}</p>}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Kaynağı sil"
        message={removing ? `"${removing.name}" listeden ve seçim kutularından kalkar. Eski randevular kaynağını korur.` : ""}
        confirmLabel="Sil"
        danger
        busy={busy}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
