import type { AttachedImage } from "../../api/ai";

// Turning a dropped / pasted / picked file into something the AI Assistant can both SHOW (a
// thumbnail in the composer and the sent bubble) and SEND (base64 to Claude's vision API).
//
// Two jobs the UI should not have to think about:
//   · the four media types Anthropic accepts, and nothing else;
//   · a size budget. A phone screenshot is multiple megabytes, the backend rejects anything over
//     4 MiB, and a handful of them would also blow the localStorage session snapshot. So a large
//     raster is downscaled to MAX_DIM on a canvas and re-encoded as JPEG before it ever leaves the
//     browser. An animated GIF is passed through untouched (a canvas would flatten it), and simply
//     refused if it is over budget — re-encoding it would be worse than a clear error.

export interface PendingImage {
  id: string;
  /** Self-contained `data:` URL, for the <img> thumbnail and the transcript preview. */
  dataUrl: string;
  /** What actually gets sent — base64 with NO `data:` prefix + its media type. */
  media_type: AttachedImage["media_type"];
  data: string;
  /** Original filename, for the tooltip / alt text. Falls back to "pasted image". */
  name: string;
}

export const MAX_IMAGES = 4;
/** Anthropic's recommended long-edge ceiling — larger is downscaled before the API would anyway. */
const MAX_DIM = 1568;
/** The backend's hard limit per image (4 MiB of decoded bytes). */
const MAX_BYTES = 4 * 1024 * 1024;

const ALLOWED: ReadonlySet<string> = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
]);

/** Decoded byte count of a base64 string (what the 4 MiB limit is counted in). */
export const decodedBytes = (base64: string): number => {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
};

const readAsDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the image file"));
    r.readAsDataURL(file);
  });

const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file is not a readable image"));
    img.src = dataUrl;
  });

const base64Of = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(",") + 1);

let seq = 0;
const nextId = () => `img-${Date.now()}-${seq++}`;

/**
 * Validate + normalise ONE file into a PendingImage. Throws an Error with a user-facing message on
 * anything unusable (wrong type, unreadable, still too big after downscaling).
 */
export async function fileToPendingImage(file: File): Promise<PendingImage> {
  if (!ALLOWED.has(file.type)) {
    throw new Error(`"${file.name || "image"}" is a ${file.type || "unknown"} file — only PNG, JPEG, GIF and WebP images can be attached`);
  }
  const name = file.name || "pasted image";
  const original = await readAsDataURL(file);

  // GIF: pass through (a canvas would drop the animation). Enforce the budget as-is.
  if (file.type === "image/gif") {
    const data = base64Of(original);
    if (decodedBytes(data) > MAX_BYTES) {
      throw new Error(`"${name}" is too large (max 4 MB per image)`);
    }
    return { id: nextId(), dataUrl: original, media_type: "image/gif", data, name };
  }

  const img = await loadImage(original);
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);

  // Small enough and already within budget → keep the original bytes and type.
  if (longEdge <= MAX_DIM) {
    const data = base64Of(original);
    if (decodedBytes(data) <= MAX_BYTES && (file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp")) {
      return { id: nextId(), dataUrl: original, media_type: file.type, data, name };
    }
  }

  // Downscale to MAX_DIM and re-encode as JPEG — the predictable way to get a screenshot under 4 MiB.
  const scale = Math.min(1, MAX_DIM / longEdge);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not process the image");
  // White matte so a transparent PNG doesn't go black when flattened to JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const jpeg = canvas.toDataURL("image/jpeg", 0.85);
  const data = base64Of(jpeg);
  if (decodedBytes(data) > MAX_BYTES) {
    throw new Error(`"${name}" is too large even after resizing (max 4 MB per image)`);
  }
  return { id: nextId(), dataUrl: jpeg, media_type: "image/jpeg", data, name };
}
