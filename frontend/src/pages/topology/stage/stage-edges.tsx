import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { Vec3 } from "./layout3d";
import type { NodeGroup, RoutedPath, RoutedTrunk } from "./contracts";
import type { StagePalette } from "./palette";
import { makeGlow } from "./labels";
import type { EdgeActivity } from "../flowAnimation";
import { CaptionSprite } from "./stage-primitives";
import { arcPoints } from "./stage-geometry";

// ── Cables and paths ─────────────────────────────────────────────────────────

export const Cable: React.FC<{ from: Vec3; to: Vec3; color: string; opacity: number; width: number }> =
  ({ from, to, color, opacity, width }) => {
    const points = useMemo(() => arcPoints(from, to, 0.4, 20), [from, to]);
    return <Line points={points} color={color} lineWidth={width} transparent opacity={opacity} />;
  };

/** Traffic, as dots riding whatever curve they were measured on (a trunk or a splayed path). */
export const FlowOnCurve: React.FC<{ curve: THREE.Curve<THREE.Vector3>; color: string; tier: EdgeActivity }> =
  ({ curve, color, tier }) => {
    const refs = useRef<(THREE.Mesh | null)[]>([]);
    const speed = tier === 2 ? 0.3 : 0.14;
    useFrame((state) => {
      const t = state.clock.elapsedTime * speed;
      refs.current.forEach((m, i) => {
        if (!m) return;
        const p = curve.getPoint((t + i / refs.current.length) % 1);
        m.position.set(p.x, p.y, p.z);
      });
    });
    return (
      <>
        {[0, 1].map((i) => (
          <mesh key={i} ref={(el) => { refs.current[i] = el; }}>
            <sphereGeometry args={[tier === 2 ? 0.05 : 0.04, 10, 10]} />
            <meshBasicMaterial color={color} />
          </mesh>
        ))}
      </>
    );
  };

// ── Bundled trunks + splay ─────────────────────────────────────────────────────
// The old scene drew one tall arc per edge, bowing over the box; two dozen of them overlapped into
// spaghetti. Now every edge that touches a group rides ONE low, horizontal TRUNK (a tube) from the
// firewall's egress rail to the group — the firewall is literally the hub every permitted path
// passes through, so routing to it is the honest shape. Small or hovered groups splay back into
// individual member lines. See routing.ts for the geometry.

/** One bundled trunk, as a tube. Thickness encodes how many paths it carries; only an uninspected
 *  bundle glows (the alarm). The tube geometry is owned here and disposed on change. */
export const Trunk: React.FC<{
  trunk: RoutedTrunk; dim: boolean; reduced: boolean;
  onHover: (id: string | null) => void; onOpen: () => void;
}> = ({ trunk, dim, reduced, onHover, onOpen }) => {
  const geom = useMemo(
    () => new THREE.TubeGeometry(trunk.curve, 56, trunk.radius, 8, false),
    [trunk],
  );
  useEffect(() => () => geom.dispose(), [geom]);
  const alarm = trunk.uninspected > 0;
  return (
    <group>
      <mesh geometry={geom}
        onPointerOver={(e) => { e.stopPropagation(); onHover(trunk.id); }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}>
        <meshStandardMaterial color={trunk.color}
          emissive={alarm ? trunk.color : "#000000"} emissiveIntensity={alarm ? 0.45 : 0}
          roughness={0.4} metalness={0.05}
          transparent opacity={dim ? 0.06 : alarm ? 0.92 : 0.64} />
      </mesh>
      {trunk.activity > 0 && !reduced && !dim && (
        <FlowOnCurve curve={trunk.curve} color={trunk.color} tier={trunk.activity} />
      )}
    </group>
  );
};

/** One edge drawn as its own thin line — for a small group, or a group the pointer is over. */
export const SplayLine: React.FC<{ path: RoutedPath; dim: boolean; reduced: boolean }> =
  ({ path, dim, reduced }) => {
    const points = useMemo(() => path.curve.getPoints(44), [path]);
    return (
      <>
        <Line points={points} color={path.color}
          lineWidth={path.uninspected ? 2.2 : 1.5}
          transparent opacity={dim ? 0.05 : path.uninspected ? 0.9 : 0.5}
          dashed={path.denyOnly} dashSize={0.16} gapSize={0.12} />
        {path.activity > 0 && !reduced && !dim && (
          <FlowOnCurve curve={path.curve} color={path.color} tier={path.activity} />
        )}
      </>
    );
  };

// ── Group platforms ─────────────────────────────────────────────────────────────
// Forty devices read as a handful of labelled platforms rather than forty loose boxes. A slab is a
// shelf the tiles of one group stand on; its header says what the group is and how many it holds.

export const StageGroup: React.FC<{ group: NodeGroup; palette: StagePalette; dim: boolean }> =
  ({ group, palette, dim }) => {
    const { region } = group;
    const baseY = group.side === "vpn" ? 1.03 : 0;
    const accent = group.side === "outside" ? palette.outside : palette.muted;
    // No slab — the user read the filled platforms as clutter. A group is now just a QUIET soft
    // footprint (an accent-tinted floor glow) with a floating header above it, so forty devices still
    // read as a handful of labelled zones but nothing competes with the tiles or the appliance.
    const glow = useMemo(() => makeGlow(accent, 0.46), [accent]);
    useEffect(() => () => glow.dispose(), [glow]);
    // A crisp, thin floor OUTLINE bounds the zone so it reads clearly as one group — delineation
    // without a heavy slab. Rounded-ish corners by insetting the straight runs slightly.
    // Inset the outline so it hugs the tiles rather than floating out at the padded region edge.
    const hw = (region.width / 2) * 0.86, hd = (region.depth / 2) * 0.9, cx = region.center.x, cz = region.center.z;
    const oy = baseY + 0.012;
    const ring = useMemo(() => {
      const r = Math.min(0.5, hw * 0.3, hd * 0.3);
      const pts: [number, number, number][] = [
        [cx - hw + r, oy, cz - hd], [cx + hw - r, oy, cz - hd], [cx + hw, oy, cz - hd + r],
        [cx + hw, oy, cz + hd - r], [cx + hw - r, oy, cz + hd], [cx - hw + r, oy, cz + hd],
        [cx - hw, oy, cz + hd - r], [cx - hw, oy, cz - hd + r], [cx - hw + r, oy, cz - hd],
      ];
      return pts;
    }, [cx, cz, hw, hd, oy]);
    return (
      <group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, baseY + 0.006, cz]}>
          <planeGeometry args={[region.width * 1.1, region.depth * 1.1]} />
          <meshBasicMaterial map={glow} transparent opacity={dim ? 0.04 : 0.1} depthWrite={false} />
        </mesh>
        <Line points={ring} color={accent} lineWidth={1.2} transparent opacity={dim ? 0.1 : 0.3} />
        {/* Header floats above the group. */}
        <CaptionSprite text={`${group.label} · ${group.total}`}
          pos={[cx, baseY + 0.34, cz]} color={accent} size={11} />
        {group.overflow > 0 && (
          <CaptionSprite text={`+${group.overflow} more`}
            pos={[cx, baseY + 0.2, cz]} color={palette.muted} size={9} />
        )}
      </group>
    );
  };

