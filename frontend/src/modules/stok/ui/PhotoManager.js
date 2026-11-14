"use client";

import { useRef, useState } from "react";
import ConfirmDialog from "@/modules/shared/ui/ConfirmDialog";
import { useToast } from "@/modules/shared/ui/Toast";
import { photoFileError } from "../stockRules";
import { addProductPhoto, removeProductPhoto } from "../server/actions";
import { PhotoError, resizeImage } from "./resizeImage";

// The model's photos inside "Model düzenle": thumbnails, "Fotoğraf ekle" and delete. The list comes from the
// server; after each change the action's refresh() brings the new list, so no copy is kept here.
export default function PhotoManager({ productId, photos }) {
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null); // photo waiting for confirmation

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // choosing the same file again must fire onChange again
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      const small = await resizeImage(file);
      const problem = photoFileError(small);
      if (problem) return setError(problem);

      const form = new FormData();
      form.set("productId", String(productId));
      form.set("photo", small);
      const result = await addProductPhoto(form);
      if (!result?.ok) return setError(result?.error ?? "Fotoğraf yüklenemedi.");
      toast("Fotoğraf eklendi.");
    } catch (problem) {
      // A refused request (too large, connection lost) throws too, but its text is not meant for people.
      setError(problem instanceof PhotoError ? problem.message : "Fotoğraf yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      const result = await removeProductPhoto(deleting.id);
      if (!result?.ok) {
        setError(result?.error ?? "Fotoğraf silinemedi.");
      } else {
        toast("Fotoğraf silindi.");
      }
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stock-photos" aria-labelledby="stock-photos-title">
      <div className="stock-photos-head">
        <h3 id="stock-photos-title">Fotoğraflar</h3>
        <button type="button" className="ui-button ui-button-ghost" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? "Bekleyin…" : "＋ Fotoğraf ekle"}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="ui-visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={upload}
        />
      </div>

      {photos.length ? (
        <ul className="stock-photo-list">
          {photos.map((photo, index) => (
            <li key={photo.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- public Storage file, already shrunk to WebP */}
              <img src={photo.url} alt={`Fotoğraf ${index + 1}`} width={96} height={96} loading="lazy" />
              <button
                type="button"
                className="stock-photo-remove"
                aria-label={`Fotoğraf ${index + 1} sil`}
                onClick={() => setDeleting(photo)}
                disabled={busy}
              >
                Sil
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="stock-muted">Bu modelin fotoğrafı yok. İlk fotoğraf listede küçük resim olarak görünür.</p>
      )}
      {error && <p className="ui-error" role="alert">{error}</p>}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Fotoğrafı sil"
        message="Fotoğraf kalıcı olarak silinir."
        confirmLabel="Sil"
        danger
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}
