import * as THREE from "three";

// Text on the stage is drawn onto a 2D canvas and used as a sprite texture. The two obvious
// alternatives are both already ruled out in this codebase (see Scene3D.tsx's own note): drei's
// <Html> mounts DOM outside React's commit and threw a real removeChild NotFoundError when the
// canvas unmounted mid-cleanup, and drei's <Text> starts a Web Worker from a blob: URL that this
// app's `script-src 'self'` CSP blocks outright. A canvas texture needs neither, billboards for
// free, and renders Thai from the same system font stack the rest of the console uses.

/** Device-pixel oversample. Labels are small on screen and cheap at this size. */
const SS = 3;

export type LabelStyle = {
  ink: string;
  muted: string;
  /** Painted behind the text so a cable crossing underneath cannot eat it. */
  halo: string;
};

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Thai", sans-serif`;

/**
 * Text sprites are almost always displayed SMALLER than the canvas they were drawn on, which sends
 * three.js to a mipmap — and a mipmapped 12px glyph loses its thin strokes entirely. In light mode
 * that turned every address line into a grey smear. Linear filtering with no mipmaps keeps the
 * stroke, and these textures are small enough that the sampling cost is irrelevant.
 */
const crisp = (texture: THREE.CanvasTexture): THREE.CanvasTexture => {
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
};

/** Measures with the same font it draws with, so a long Thai name sizes its plate correctly. */
const measure = (ctx: CanvasRenderingContext2D, text: string, font: string): number => {
  ctx.font = font;
  return ctx.measureText(text).width;
};

export type Label = { texture: THREE.CanvasTexture; w: number; h: number };

/**
 * A two-line plate: name, then detail. The plate is sized to the text rather than fixed-width, so
 * short names do not sit in a wide empty box and long ones are not clipped to an ellipsis the
 * operator cannot expand.
 */
export const makeLabel = (name: string, detail: string, style: LabelStyle): Label => {
  const probe = document.createElement("canvas").getContext("2d")!;
  const nameFont = `600 15px ${FONT}`;
  const detailFont = `500 13px ${FONT}`;

  const padX = 9;
  const w = Math.ceil(Math.max(measure(probe, name, nameFont), detail ? measure(probe, detail, detailFont) : 0)) + padX * 2;
  const h = detail ? 38 : 24;

  const canvas = document.createElement("canvas");
  canvas.width = w * SS;
  canvas.height = h * SS;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SS, SS);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // The halo is a stroke under the fill, not a filled rectangle: a plate would read as another
  // card on a stage that already has cards on it.
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  const line = (text: string, font: string, fill: string, y: number, haloW: number) => {
    ctx.font = font;
    ctx.strokeStyle = style.halo;
    ctx.lineWidth = haloW;
    ctx.strokeText(text, w / 2, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, w / 2, y);
  };

  // Halo widths are tuned per line, not shared. At 3.5px under a 12px glyph the stroke closed up
  // the counters of the detail line and it read as a grey smear on a light background.
  line(name, nameFont, style.ink, detail ? 16 : 17, 3.6);
  if (detail) line(detail, detailFont, style.muted, 32, 2.2);

  return { texture: crisp(new THREE.CanvasTexture(canvas)), w, h };
};

/** A single short caption — lane headings, the model mark, the faceplate's port counts. */
export const makeCaption = (
  text: string,
  color: string,
  { size = 12, weight = 700, tracking = 0.14 }: { size?: number; weight?: number; tracking?: number } = {},
): Label => {
  const probe = document.createElement("canvas").getContext("2d")!;
  const font = `${weight} ${size}px ${FONT}`;
  // Letter-spacing is applied by hand: canvas has no tracking, and CSS text-transform/letter-spacing
  // is not available here. Captions are never uppercased in code — Thai has no case, and forcing it
  // produces nothing for a Thai string while shouting in an English one.
  const spaced = tracking ? [...text].join(" ".repeat(Math.round(tracking * 10))) : text;
  const w = Math.ceil(measure(probe, spaced, font)) + 10;
  const h = size + 10;

  const canvas = document.createElement("canvas");
  canvas.width = w * SS;
  canvas.height = h * SS;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SS, SS);
  ctx.textAlign = "center";
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(spaced, w / 2, size + 1);

  return { texture: crisp(new THREE.CanvasTexture(canvas)), w, h };
};

/** A soft radial dot: the LED bloom, without a postprocessing pass to get it. */
export const makeGlow = (color: string, core = 0.9): THREE.CanvasTexture => {
  const { r, g, b } = new THREE.Color(color);
  const rgb = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${rgb},${core})`);
  grad.addColorStop(0.35, `rgba(${rgb},0.34)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};
