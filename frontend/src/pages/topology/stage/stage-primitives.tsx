import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Vec3 } from "./layout3d";
import type { StagePalette } from "./palette";
import { makeCaption, makeGlow, makeLabel } from "./labels";

// The pieces every other layer of the stage is drawn out of: the two text sprites, the additive
// glow, the floor wash and the painted shadow. (The geometry they share is in stage-geometry.ts,
// which is not a .tsx file so that exporting a function from it costs nothing.)
//
// Nothing here knows what a firewall, a zone or a path is — which is why it is the layer the other
// four import from and never the other way round.

// ── Sprites ──────────────────────────────────────────────────────────────────

export const LabelSprite: React.FC<{
  name: string; detail?: string; pos: [number, number, number]; palette: StagePalette;
}> = ({ name, detail = "", pos, palette }) => {
  const label = useMemo(
    () => makeLabel(name, detail, { ink: palette.ink, muted: palette.muted, halo: palette.halo }),
    [name, detail, palette],
  );
  useEffect(() => () => label.texture.dispose(), [label]);
  const k = 1 / 104;
  return (
    <sprite position={pos} scale={[label.w * k, label.h * k, 1]} renderOrder={10}>
      <spriteMaterial map={label.texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
};

export const CaptionSprite: React.FC<{
  text: string; pos: [number, number, number]; color: string; size?: number;
}> = ({ text, pos, color, size = 12 }) => {
  const cap = useMemo(() => makeCaption(text, color, { size }), [text, color, size]);
  useEffect(() => () => cap.texture.dispose(), [cap]);
  const k = 1 / 104;
  return (
    <sprite position={pos} scale={[cap.w * k, cap.h * k, 1]} renderOrder={10}>
      <spriteMaterial map={cap.texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
};

/** The bloom around a lit port — one sprite, instead of a postprocessing pass over the whole scene. */
export const Glow: React.FC<{ color: string; pos: [number, number, number]; size: number; opacity?: number }> =
  ({ color, pos, size, opacity = 1 }) => {
    const tex = useMemo(() => makeGlow(color), [color]);
    useEffect(() => () => tex.dispose(), [tex]);
    return (
      <sprite position={pos} scale={[size, size, 1]}>
        <spriteMaterial map={tex} transparent opacity={opacity} depthWrite={false}
          blending={THREE.AdditiveBlending} />
      </sprite>
    );
  };

// ── Floor ────────────────────────────────────────────────────────────────────
// A wash, not a grid. The grid was the single most wrong thing about the old scene: it filled the
// panel with ruled lines carrying no information and made the device look like it sat on graph paper.

export const Floor: React.FC<{ palette: StagePalette; center: Vec3; size: number }> = ({ palette, center, size }) => {
  // The first attempt was an opaque rectangle, which gave the scene a hard horizon: a grey slab
  // with a visible cliff edge running across the panel. A disc that fades to fully transparent has
  // no edge to see, so the device reads as standing ON something without that something becoming
  // the biggest shape on screen.
  const texture = useMemo(() => {
    const px = 512;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d")!;
    const { r, g, b } = new THREE.Color(palette.floor);
    const rgb = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
    const grad = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(0.46, `rgba(${rgb},0.92)`);
    grad.addColorStop(0.74, `rgba(${rgb},0.4)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, px, px);
    const t = new THREE.CanvasTexture(canvas);
    t.needsUpdate = true;
    return t;
  }, [palette]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center.x, -0.02, center.z]}>
      <planeGeometry args={[size, size * 0.82]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
};

/** A painted soft shadow: cheaper and far more controllable than a shadow map at this scale. */
export const DropShadow: React.FC<{ pos: [number, number, number]; w: number; d: number; opacity: number }> =
  ({ pos, w, d, opacity }) => {
    const tex = useMemo(() => makeGlow("#000000", 0.5), []);
    useEffect(() => () => tex.dispose(), [tex]);
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={pos}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial map={tex} transparent opacity={opacity} depthWrite={false} />
      </mesh>
    );
  };

