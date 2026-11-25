import { MAX_ICON_BYTES } from "../homeRules";

// Browser only. A logo is shown at 27 px, so it is redrawn at most 128 px on its longer edge and saved as WebP
// (PNG where the browser cannot write WebP) before upload. That keeps it far under the bucket's 512 KB limit.
const MAX_EDGE = 128;

export class IconError extends Error {
  constructor(message) {
    super(message);
    this.name = "IconError";
  }
}

function toBlob(canvas, type) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
}

export async function resizeIcon(file) {
  if (!file?.type?.startsWith("image/")) throw new IconError("Logo olarak bir resim seçin (PNG, JPEG ya da WebP).");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new IconError("Bu dosya resim olarak açılamadı.");
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  let blob = await toBlob(canvas, "image/webp");
  if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/png");
  if (!blob || blob.size > MAX_ICON_BYTES) throw new IconError("Logo küçültülemedi. Daha küçük bir resim seçin.");
  const extension = blob.type === "image/webp" ? "webp" : "png";
  return new File([blob], `logo.${extension}`, { type: blob.type });
}
