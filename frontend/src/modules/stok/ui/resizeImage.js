import { MAX_PHOTO_BYTES } from "../stockRules";

// Browser only. A phone photo is often 4000 px and several MB; the Server Action accepts about 1 MB and the
// list shows small thumbnails, so the file is redrawn with its longer edge at most 1600 px and saved as WebP
// before it leaves the browser. Doing it here also keeps the free Storage quota (1 GB) from filling up.

const MAX_EDGE = 1600;

// Its message is written for the user, so the photo manager can show it as is.
export class PhotoError extends Error {
  constructor(message) {
    super(message);
    this.name = "PhotoError";
  }
}

const QUALITIES = [0.82, 0.7, 0.6, 0.5];

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// createImageBitmap applies the camera's rotation (EXIF) itself, so portrait photos do not come out sideways.
async function decode(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new PhotoError("Bu dosya fotoğraf olarak açılamadı. JPEG, PNG ya da WebP seçin.");
  }
}

export async function resizeImage(file) {
  if (!file?.type?.startsWith("image/")) throw new PhotoError("Yalnızca fotoğraf seçin (JPEG, PNG ya da WebP).");

  const bitmap = await decode(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  // Lower the quality step by step until it fits. A browser that cannot write WebP returns PNG instead;
  // then JPEG is used, because a 1600 px PNG photo would rarely fit under the limit.
  for (const quality of QUALITIES) {
    let blob = await toBlob(canvas, "image/webp", quality);
    if (blob && blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
    if (blob && blob.size <= MAX_PHOTO_BYTES) {
      const extension = blob.type === "image/webp" ? "webp" : "jpg";
      const base = (file.name || "foto").replace(/\.[^.]+$/, "");
      return new File([blob], `${base}.${extension}`, { type: blob.type });
    }
  }
  throw new PhotoError("Fotoğraf küçültülemedi. Daha küçük bir fotoğraf seçin.");
}
