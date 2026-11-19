import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { PlacedNode, PlacedSocket, StageLayout } from "./layout3d";
import type { StagePalette } from "./palette";
import { laneAccent } from "./palette";
import { CaptionSprite, DropShadow, Glow, LabelSprite } from "./stage-primitives";
import { BlinkLed } from "./stage-devices";
import { socketTone } from "./stage-appliance.logic";

// ── Chassis ──────────────────────────────────────────────────────────────────

/** The lit identity strip across the appliance's face — breathes under idle animation. */
export const BrandStrip: React.FC<{ color: string; pos: [number, number, number]; w: number; reduced: boolean }> =
  ({ color, pos, w, reduced }) => {
    const ref = useRef<THREE.MeshStandardMaterial>(null);
    useFrame((s) => {
      if (reduced || !ref.current) return;
      ref.current.emissiveIntensity = 0.45 + 0.22 * Math.sin(s.clock.elapsedTime * 1.2);
    });
    return (
      <mesh position={pos}>
        <boxGeometry args={[w, 0.03, 0.012]} />
        <meshStandardMaterial ref={ref} color={color} emissive={color} emissiveIntensity={0.5} roughness={0.3} />
      </mesh>
    );
  };

// A premium 1U-style rackmount appliance: a bevelled brushed-steel body (RoundedBox), a lit front
// bezel with a breathing brand strip + status/PSU LEDs, vent slats, rack ears, and a connector nub
// on each egress rail so the bundled trunks read as plugging into real hardware. The top socket band
// is left open exactly as before so the Sockets layer still lands in its recess.
export const Chassis: React.FC<{
  layout: StageLayout; palette: StagePalette; deviceName: string;
  captions: { fixed: string; numbered: string }; reduced: boolean;
}> = ({ layout, palette, deviceName, captions, reduced }) => {
  const { width: W, depth: D, height: H } = layout.chassis;
  const fz = D / 2; // front face z (toward the camera)
  return (
    <group>
      <DropShadow pos={[0, 0.002, 0.1]} w={W * 2.1} d={D * 3.6} opacity={0.3} />

      {/* Rubber-foot plinth, so the body stands ON the floor rather than fused to it. */}
      <mesh position={[0, 0.016, 0]}>
        <boxGeometry args={[W * 0.96, 0.032, D * 0.92]} />
        <meshStandardMaterial color={palette.bezel} roughness={0.8} />
      </mesh>

      {/* Brushed-steel body — bevelled, so edges catch the key light. */}
      <RoundedBox args={[W, H, D]} radius={0.03} smoothness={3} position={[0, H / 2, 0]}>
        <meshStandardMaterial color={palette.chassis} roughness={0.4} metalness={0.55} />
      </RoundedBox>

      {/* Top lip + the dark socket recess — UNCHANGED, so the jacks still land in their band. */}
      <mesh position={[0, H + 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color={palette.chassisEdge} roughness={0.42} metalness={0.1} />
      </mesh>
      <mesh position={[0, H + 0.007, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W - 0.34, 0.74]} />
        <meshStandardMaterial color={palette.bezel} roughness={0.84} metalness={0.02} />
      </mesh>

      {/* Front bezel — the premium face. */}
      <RoundedBox args={[W * 0.99, H * 0.9, 0.05]} radius={0.02} smoothness={2} position={[0, H / 2, fz + 0.015]}>
        <meshStandardMaterial color={palette.bezel} roughness={0.5} metalness={0.3} />
      </RoundedBox>

      {/* Logo emboss (far left of the bezel). */}
      <RoundedBox args={[0.12, 0.14, 0.02]} radius={0.01} smoothness={2} position={[-W / 2 + 0.2, H * 0.5, fz + 0.045]}>
        <meshStandardMaterial color={palette.chassisTrim} roughness={0.35} metalness={0.6} />
      </RoundedBox>

      <BrandStrip color={palette.brand} pos={[-W * 0.14, H * 0.64, fz + 0.045]} w={W * 0.34} reduced={reduced} />

      {/* Vent slats flanking the bezel. */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * W * 0.33, H * 0.5, fz + 0.03]}>
          {[-0.09, 0, 0.09].map((dy) => (
            <mesh key={dy} position={[0, dy, 0]}>
              <boxGeometry args={[W * 0.2, 0.03, 0.008]} />
              <meshStandardMaterial color={palette.chassisVent} roughness={0.85} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Rack ears with screw holes — the rackmount signature, pinned to the body edges. */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (W / 2 + 0.03), H * 0.5, 0]}>
          <mesh>
            <boxGeometry args={[0.06, H * 1.08, D * 0.6]} />
            <meshStandardMaterial color={palette.chassisTrim} roughness={0.45} metalness={0.4} />
          </mesh>
          {[-D * 0.18, D * 0.18].map((z) => (
            <mesh key={z} position={[s * 0.005, 0, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.013, 0.013, 0.075, 10]} />
              <meshStandardMaterial color={palette.bezel} roughness={0.6} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Status / PSU LED cluster (right of the bezel). */}
      <BlinkLed pos={[W / 2 - 0.42, H * 0.6, fz + 0.05]} color={palette.up} reduced={reduced} base={0.95} speed={1.2} r={0.014} />
      <BlinkLed pos={[W / 2 - 0.28, H * 0.6, fz + 0.05]} color={palette.select} reduced={reduced} base={0.6} phase={1.3} r={0.014} />
      <BlinkLed pos={[W / 2 - 0.14, H * 0.6, fz + 0.05]} color={palette.warn} reduced={reduced} base={0.4} phase={2.1} r={0.012} />

      {/* A connector nub where each bundled trunk plugs into the body. */}
      {(["outside", "inside", "vpn"] as const).map((side) => {
        const r = layout.egress.rails[side];
        return (
          <mesh key={side} position={[r.center.x, r.center.y, r.center.z]}>
            <boxGeometry args={[0.07, 0.05, 0.07]} />
            <meshStandardMaterial color={palette.chassisVent} roughness={0.7} metalness={0.3} />
          </mesh>
        );
      })}

      <CaptionSprite text={deviceName} pos={[0, H + 0.52, -(D / 2) - 0.46]} color={palette.ink} size={13} />
      {captions.fixed && (
        <CaptionSprite text={captions.fixed} pos={[-W / 2 + 0.32, H + 0.15, D / 2 + 0.03]}
          color={palette.muted} size={7} />
      )}
      {captions.numbered && (
        <CaptionSprite text={captions.numbered} pos={[W / 2 - 0.64, H + 0.15, D / 2 + 0.03]}
          color={palette.muted} size={7} />
      )}
    </group>
  );
};

export const Sockets: React.FC<{
  sockets: PlacedSocket[]; palette: StagePalette; lit: Set<string> | null;
  onHover: (id: string | null) => void; onOpen: (name: string) => void;
}> = ({ sockets, palette, lit, onHover, onOpen }) => (
  <group>
    {sockets.map((s) => {
      const tone = socketTone(s, palette);
      const dim = lit !== null && !lit.has(s.name);
      return (
        <group key={s.name} position={[s.pos.x, s.pos.y + 0.011, s.pos.z]}>
          <mesh
            onPointerOver={(e) => { e.stopPropagation(); onHover(s.name); }}
            onPointerOut={() => onHover(null)}
            onClick={(e) => { e.stopPropagation(); onOpen(s.name); }}
          >
            <boxGeometry args={[0.2, 0.028, 0.15]} />
            <meshStandardMaterial
              color={tone.body}
              emissive={tone.glow ? tone.body : "#000000"}
              emissiveIntensity={tone.glow ? 0.9 : 0}
              roughness={0.45}
              transparent={dim}
              opacity={dim ? 0.3 : 1}
            />
          </mesh>
          {tone.glow && !dim && <Glow color={palette.up} pos={[0, 0.06, 0]} size={0.4} opacity={0.8} />}
        </group>
      );
    })}
  </group>
);

// ── Tiles ────────────────────────────────────────────────────────────────────

const TILE_W = 1.3;
const TILE_D = 0.6;
const TILE_H = 0.17;

export const Tile: React.FC<{
  node: PlacedNode; palette: StagePalette; dim: boolean;
  onHover: (id: string | null) => void; onOpen: () => void;
}> = ({ node, palette, dim, onHover, onOpen }) => {
  const accent = laneAccent(node.lane, palette);
  const up = node.up !== false;
  const status = node.up === undefined ? null : node.up ? palette.up : palette.down;

  return (
    <group position={[node.pos.x, node.pos.y, node.pos.z]}>
      <mesh
        position={[0, TILE_H / 2, 0]}
        onPointerOver={(e) => { e.stopPropagation(); onHover(node.id); }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
      >
        <boxGeometry args={[TILE_W, TILE_H, TILE_D]} />
        <meshStandardMaterial color={palette.tile} roughness={0.9} metalness={0}
          transparent={dim} opacity={dim ? 0.35 : 1} />
      </mesh>

      {/* A rim just under the tile. Without it a matte block of one colour has no outline, and in
          dark mode it dissolves into the floor as soon as the key light falls off. */}
      <mesh position={[0, 0.012, 0]}>
        <boxGeometry args={[TILE_W + 0.07, 0.024, TILE_D + 0.07]} />
        <meshStandardMaterial color={palette.tileEdge} roughness={0.8}
          transparent opacity={dim ? 0.25 : 0.9} />
      </mesh>

      {/* The lane's accent runs along the edge facing the device, so a glance down a lane reads as
          one group rather than three unrelated cards. */}
      <mesh position={[0, TILE_H / 2, node.lane === "inside" ? -TILE_D / 2 : TILE_D / 2]}>
        <boxGeometry args={[TILE_W, TILE_H * 1.05, 0.024]} />
        <meshStandardMaterial color={accent} roughness={0.5}
          transparent opacity={dim ? 0.3 : node.lane === "outside" ? 0.95 : 0.45} />
      </mesh>

      {status && (
        <>
          <mesh position={[-TILE_W / 2 + 0.14, TILE_H + 0.011, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.02, 16]} />
            <meshStandardMaterial color={status} emissive={up ? status : "#000000"}
              emissiveIntensity={up ? 0.9 : 0} roughness={0.4} />
          </mesh>
          {up && !dim && (
            <Glow color={palette.up} pos={[-TILE_W / 2 + 0.14, TILE_H + 0.05, 0]} size={0.3} opacity={0.6} />
          )}
        </>
      )}

      <LabelSprite name={node.label} detail={node.detail} pos={[0.06, TILE_H + 0.56, 0]} palette={palette} />
    </group>
  );
};

