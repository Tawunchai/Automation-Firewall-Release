import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { Vec3 } from "./layout3d";
import type { PlacedUserDevice } from "./userDevices";
import type { TopologyDeviceStatus } from "../../../api/topologyDevices";
import type { StagePalette } from "./palette";
import { DropShadow, Glow, LabelSprite } from "./stage-primitives";
import { arcPoints } from "./stage-geometry";

// ── User-pinned devices ───────────────────────────────────────────────────────
// The user's own devices, drawn on a shelf in front of the chassis. SHAPE carries the kind — each is
// a little piece of rack hardware built from primitives (a slim switch with a lit port strip, a
// router with antennas, a monitor-and-tower endpoint, a domed AP that rings Wi-Fi, a tall drive
// server, a hardened firewall) so the seven kinds read apart at a glance. The BODY keeps its own
// realistic steel / plastic colour in every state; HEALTH is carried only by the small status LED,
// its glow, the dot above and the ping line — emerald up, red down, grey unknown — so an up device
// reads as "a switch that is fine", never as a solid green blob. A line runs from the chassis to each
// one: the firewall is what pings it.

const DOWN_RED = "#ef4444";

const statusColor = (s: TopologyDeviceStatus, palette: StagePalette): string =>
  s === "up" ? palette.up : s === "down" ? DOWN_RED : palette.unknown;

/** Darken a hex colour by a factor — used so a "down" body reads a touch dimmer without changing hue. */
const shade = (hex: string, f: number): string =>
  "#" + new THREE.Color(hex).multiplyScalar(f).getHexString();

// ── Animated glyph parts ───────────────────────────────────────────────────────
// Each owns a `useFrame` that no-ops under reduced motion (the scene then runs on demand, so the
// callback never fires anyway — the early return is belt-and-braces). Idle values in the JSX are
// chosen so the static pose still looks lit.

/** A single pulsing indicator LED, with an additive bloom so it reads as emitting light. */
export const BlinkLed: React.FC<{
  pos: [number, number, number]; color: string; reduced: boolean;
  r?: number; phase?: number; speed?: number; base?: number; bloom?: number;
}> = ({ pos, color, reduced, r = 0.02, phase = 0, speed = 2.2, base = 0.9, bloom = 0.16 }) => {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((s) => {
    if (reduced || !ref.current) return;
    const t = 0.5 + 0.5 * Math.sin(s.clock.elapsedTime * speed + phase);
    ref.current.emissiveIntensity = base * (0.3 + 0.7 * t);
  });
  return (
    <group position={pos}>
      <mesh>
        <sphereGeometry args={[r, 12, 10]} />
        <meshStandardMaterial ref={ref} color={color} emissive={color}
          emissiveIntensity={base} roughness={0.28} />
      </mesh>
      {base > 0.4 && <Glow color={color} pos={[0, 0, 0.01]} size={bloom} opacity={0.75} />}
    </group>
  );
};

/** A row of port LEDs that ripple along a switch front. */
export const PortLeds: React.FC<{ color: string; count: number; width: number; y: number; z: number; reduced: boolean }> =
  ({ color, count, width, y, z, reduced }) => {
    const refs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
    useFrame((s) => {
      if (reduced) return;
      const t = s.clock.elapsedTime;
      refs.current.forEach((m, i) => {
        if (!m) return;
        m.emissiveIntensity = 0.25 + 0.85 * (0.5 + 0.5 * Math.sin(t * 3 + i * 0.8));
      });
    });
    const step = width / count;
    return (
      <group>
        {Array.from({ length: count }).map((_, i) => (
          <mesh key={i} position={[-width / 2 + step * (i + 0.5), y, z]}>
            <boxGeometry args={[step * 0.46, 0.022, 0.014]} />
            <meshStandardMaterial ref={(el) => { refs.current[i] = el; }} color={color}
              emissive={color} emissiveIntensity={0.5} roughness={0.3} />
          </mesh>
        ))}
      </group>
    );
  };

/** Concentric Wi-Fi rings that expand and fade off an access point. */
export const WifiRings: React.FC<{ color: string; reduced: boolean }> = ({ color, reduced }) => {
  const COUNT = 3;
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame((s) => {
    if (reduced) return;
    const t = s.clock.elapsedTime;
    refs.current.forEach((m, i) => {
      if (!m) return;
      const p = (t * 0.55 + i / COUNT) % 1;
      const sc = 0.35 + p * 1.05;
      m.scale.set(sc, sc, sc);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - p);
    });
  });
  return (
    <group position={[0, 0.34, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {Array.from({ length: COUNT }).map((_, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }} scale={0.6 + i * 0.4}>
          <torusGeometry args={[0.3, 0.01, 8, 36]} />
          <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
};

/** A column of drive-activity LEDs with a scanning head — the "something is working" of a server. */
export const DriveLeds: React.FC<{ color: string; x: number; z: number; reduced: boolean }> =
  ({ color, x, z, reduced }) => {
    const COUNT = 4;
    const refs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
    useFrame((s) => {
      if (reduced) return;
      const head = (s.clock.elapsedTime * 2.2) % COUNT;
      refs.current.forEach((m, i) => {
        if (!m) return;
        m.emissiveIntensity = 0.2 + 1 * Math.max(0, 1 - Math.abs(i - head));
      });
    });
    return (
      <group>
        {Array.from({ length: COUNT }).map((_, i) => (
          <mesh key={i} position={[x, 0.16 + i * 0.11, z]}>
            <boxGeometry args={[0.022, 0.022, 0.016]} />
            <meshStandardMaterial ref={(el) => { refs.current[i] = el; }} color={color}
              emissive={color} emissiveIntensity={0.4} roughness={0.3} />
          </mesh>
        ))}
      </group>
    );
  };

/** A monitor screen that breathes a soft accent light. */
export const ScreenGlow: React.FC<{ accent: string; reduced: boolean }> = ({ accent, reduced }) => {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((s) => {
    if (reduced || !ref.current) return;
    ref.current.emissiveIntensity = 0.42 + 0.16 * Math.sin(s.clock.elapsedTime * 1.1);
  });
  return (
    <mesh position={[0, 0.34, 0.027]}>
      <planeGeometry args={[0.5, 0.31]} />
      <meshStandardMaterial ref={ref} color={accent} emissive={accent}
        emissiveIntensity={0.45} roughness={0.2} metalness={0.1} />
    </mesh>
  );
};

/** The lit identity strip across a firewall's face. */
export const FrontStrip: React.FC<{ accent: string; reduced: boolean }> = ({ accent, reduced }) => {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((s) => {
    if (reduced || !ref.current) return;
    ref.current.emissiveIntensity = 0.5 + 0.35 * Math.sin(s.clock.elapsedTime * 1.5);
  });
  return (
    <mesh position={[0, 0.085, 0.246]}>
      <boxGeometry args={[0.5, 0.03, 0.014]} />
      <meshStandardMaterial ref={ref} color={accent} emissive={accent}
        emissiveIntensity={0.6} roughness={0.3} />
    </mesh>
  );
};

/** One router antenna that sways gently. */
export const Antenna: React.FC<{ x: number; z: number; tilt: number; trim: string; reduced: boolean; phase: number }> =
  ({ x, z, tilt, trim, reduced, phase }) => {
    const ref = useRef<THREE.Group>(null);
    useFrame((s) => {
      if (reduced || !ref.current) return;
      ref.current.rotation.z = tilt + Math.sin(s.clock.elapsedTime * 1.3 + phase) * 0.05;
    });
    return (
      <group ref={ref} position={[x, 0.22, z]} rotation={[0, 0, tilt]}>
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.015, 0.026, 0.4, 10]} />
          <meshStandardMaterial color={trim} roughness={0.5} metalness={0.35} />
        </mesh>
        <mesh position={[0, 0.41, 0]}>
          <sphereGeometry args={[0.03, 10, 8]} />
          <meshStandardMaterial color={shade(trim, 0.7)} roughness={0.4} />
        </mesh>
      </group>
    );
  };

/** The glyph for one kind — a small piece of rack hardware in neutral materials, LED carrying health. */
export const DeviceGlyph: React.FC<{
  device: PlacedUserDevice; palette: StagePalette; color: string; up: boolean; reduced: boolean;
}> = ({ device, palette, color, up, reduced }) => {
  const steel = up ? palette.deviceSteel : shade(palette.deviceSteel, 0.82);
  const steelHi = palette.deviceSteelHi;
  const plastic = up ? palette.devicePlastic : shade(palette.devicePlastic, 0.84);
  const trim = palette.deviceTrim;
  const accent = palette.deviceAccent;
  const led = up ? color : device.status === "down" ? DOWN_RED : palette.unknown;
  const ledBase = up ? 0.95 : 0.25;

  switch (device.shape) {
    case "switch":
      return (
        <group>
          <RoundedBox args={[0.98, 0.17, 0.5]} radius={0.03} smoothness={3} position={[0, 0.1, 0]}>
            <meshStandardMaterial color={steel} roughness={0.36} metalness={0.6} />
          </RoundedBox>
          {/* machined top plate */}
          <mesh position={[0, 0.187, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.9, 0.42]} />
            <meshStandardMaterial color={steelHi} roughness={0.28} metalness={0.55} />
          </mesh>
          {/* rack ears */}
          {[-0.53, 0.53].map((x) => (
            <mesh key={x} position={[x, 0.1, 0]}>
              <boxGeometry args={[0.07, 0.17, 0.4]} />
              <meshStandardMaterial color={trim} roughness={0.5} metalness={0.3} />
            </mesh>
          ))}
          {/* dark port recess + rippling LEDs */}
          <mesh position={[0, 0.1, 0.251]}>
            <boxGeometry args={[0.82, 0.1, 0.012]} />
            <meshStandardMaterial color={shade(trim, 1.2)} roughness={0.75} />
          </mesh>
          <PortLeds color={accent} count={8} width={0.74} y={0.1} z={0.259} reduced={reduced} />
          <BlinkLed pos={[0.43, 0.1, 0.259]} color={led} reduced={reduced} speed={1.6} base={ledBase} r={0.016} />
        </group>
      );
    case "router":
      return (
        <group>
          <RoundedBox args={[0.62, 0.2, 0.46]} radius={0.05} smoothness={3} position={[0, 0.12, 0]}>
            <meshStandardMaterial color={steel} roughness={0.42} metalness={0.42} />
          </RoundedBox>
          {/* vented top */}
          <mesh position={[0, 0.223, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.52, 0.36]} />
            <meshStandardMaterial color={shade(trim, 1.3)} roughness={0.85} />
          </mesh>
          <Antenna x={-0.2} z={-0.12} tilt={0.32} trim={trim} reduced={reduced} phase={0} />
          <Antenna x={0} z={-0.12} tilt={0} trim={trim} reduced={reduced} phase={1.1} />
          <Antenna x={0.2} z={-0.12} tilt={-0.32} trim={trim} reduced={reduced} phase={2.2} />
          <BlinkLed pos={[-0.12, 0.12, 0.236]} color={accent} reduced={reduced} phase={0.4} r={0.016} />
          <BlinkLed pos={[0.0, 0.12, 0.236]} color={accent} reduced={reduced} phase={1.4} r={0.016} />
          <BlinkLed pos={[0.14, 0.12, 0.236]} color={led} reduced={reduced} speed={1.6} base={ledBase} r={0.016} />
        </group>
      );
    case "endpoint":
      return (
        <group>
          {/* monitor */}
          <RoundedBox args={[0.58, 0.4, 0.045]} radius={0.015} smoothness={2} position={[0, 0.34, -0.02]}>
            <meshStandardMaterial color={trim} roughness={0.5} metalness={0.2} />
          </RoundedBox>
          <ScreenGlow accent={accent} reduced={reduced} />
          {/* stand */}
          <mesh position={[0, 0.12, -0.02]}><boxGeometry args={[0.05, 0.16, 0.04]} />
            <meshStandardMaterial color={shade(plastic, 0.85)} roughness={0.5} /></mesh>
          <mesh position={[0, 0.035, 0]}><boxGeometry args={[0.26, 0.03, 0.14]} />
            <meshStandardMaterial color={shade(plastic, 0.85)} roughness={0.5} /></mesh>
          {/* tower beside it */}
          <RoundedBox args={[0.15, 0.3, 0.22]} radius={0.015} smoothness={2} position={[0.44, 0.15, 0.05]}>
            <meshStandardMaterial color={plastic} roughness={0.45} metalness={0.1} />
          </RoundedBox>
          <BlinkLed pos={[0.44, 0.27, 0.165]} color={led} reduced={reduced} base={ledBase} r={0.013} />
        </group>
      );
    case "ap":
      return (
        <group>
          <mesh position={[0, 0.065, 0]}>
            <cylinderGeometry args={[0.36, 0.4, 0.12, 36]} />
            <meshStandardMaterial color={plastic} roughness={0.4} metalness={0.05} />
          </mesh>
          {/* dome */}
          <mesh position={[0, 0.125, 0]} scale={[1, 0.5, 1]}>
            <sphereGeometry args={[0.3, 28, 18]} />
            <meshStandardMaterial color={shade(plastic, 1.04)} roughness={0.32} />
          </mesh>
          <BlinkLed pos={[0, 0.2, 0]} color={led} reduced={reduced} base={up ? 1 : 0.3} r={0.03} speed={1.4} bloom={0.26} />
          <WifiRings color={accent} reduced={reduced} />
        </group>
      );
    case "server":
      return (
        <group>
          <RoundedBox args={[0.44, 0.66, 0.46]} radius={0.025} smoothness={3} position={[0, 0.33, 0]}>
            <meshStandardMaterial color={steel} roughness={0.4} metalness={0.5} />
          </RoundedBox>
          {/* front bezel */}
          <mesh position={[0, 0.33, 0.231]}>
            <boxGeometry args={[0.4, 0.62, 0.012]} />
            <meshStandardMaterial color={shade(trim, 1.15)} roughness={0.7} />
          </mesh>
          {/* drive-bay slits */}
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[-0.05, 0.5 - i * 0.12, 0.238]}>
              <boxGeometry args={[0.26, 0.055, 0.01]} />
              <meshStandardMaterial color={shade(steelHi, 0.9)} roughness={0.5} metalness={0.4} />
            </mesh>
          ))}
          <DriveLeds color={accent} x={0.14} z={0.239} reduced={reduced} />
          <BlinkLed pos={[0.14, 0.09, 0.239]} color={led} reduced={reduced} base={ledBase} r={0.015} />
        </group>
      );
    case "firewall":
      return (
        <group>
          <RoundedBox args={[0.64, 0.36, 0.48]} radius={0.04} smoothness={3} position={[0, 0.19, 0]}>
            <meshStandardMaterial color={shade(steel, 0.82)} roughness={0.34} metalness={0.65} />
          </RoundedBox>
          <mesh position={[0, 0.375, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.56, 0.4]} />
            <meshStandardMaterial color={steel} roughness={0.3} metalness={0.55} />
          </mesh>
          <FrontStrip accent={accent} reduced={reduced} />
          {/* shield emboss */}
          <mesh position={[0, 0.22, 0.242]}>
            <boxGeometry args={[0.13, 0.15, 0.012]} />
            <meshStandardMaterial color={steelHi} roughness={0.4} metalness={0.5} />
          </mesh>
          <BlinkLed pos={[0.24, 0.3, 0.242]} color={led} reduced={reduced} base={ledBase} r={0.015} />
        </group>
      );
    default:
      return (
        <group>
          <mesh position={[0, 0.24, 0]}>
            <icosahedronGeometry args={[0.26, 0]} />
            <meshStandardMaterial color={steel} roughness={0.45} metalness={0.4} flatShading />
          </mesh>
          <BlinkLed pos={[0, 0.54, 0]} color={led} reduced={reduced} base={ledBase} r={0.022} />
        </group>
      );
  }
};

export const UserDevice: React.FC<{
  device: PlacedUserDevice; palette: StagePalette; dim: boolean; reduced: boolean;
  onHover: (id: string | null) => void; onOpen: () => void;
}> = ({ device, palette, dim, reduced, onHover, onOpen }) => {
  const color = statusColor(device.status, palette);
  const up = device.status === "up";
  const hoverId = `user:${device.id}`;

  // The whole device floats a hair and turns a few degrees, each on its own phase so a shelf of them
  // drifts like real hardware on a desk rather than ticking in lockstep. The floor shadow and the
  // label stay put — only the body, its status dot and glow ride the bob.
  const bob = useRef<THREE.Group>(null);
  const phase = (device.id % 10) * 0.9;
  useFrame((s) => {
    if (reduced || !bob.current) return;
    const t = s.clock.elapsedTime;
    bob.current.position.y = Math.sin(t * 1.1 + phase) * 0.035;
    bob.current.rotation.y = Math.sin(t * 0.5 + phase) * 0.09;
  });

  return (
    <group position={[device.pos.x, device.pos.y, device.pos.z]}>
      {/* A soft disc on the floor, tinted by health — reads as a status ring under the glyph. */}
      <DropShadow pos={[0, 0.004, 0]} w={0.95} d={0.95} opacity={dim ? 0.12 : 0.26} />
      <group ref={bob}>
        <group
          onPointerOver={(e) => { e.stopPropagation(); onHover(hoverId); }}
          onPointerOut={() => onHover(null)}
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
        >
          <DeviceGlyph device={device} palette={palette} color={color} up={up} reduced={reduced} />
        </group>
        {/* The status dot above the glyph, so health is legible even where the body colour is subtle.
            Lifted clear of the tallest model (the server). */}
        <mesh position={[0, 0.86, 0]}>
          <sphereGeometry args={[0.055, 12, 10]} />
          <meshStandardMaterial color={color} emissive={up ? color : "#000000"}
            emissiveIntensity={up ? 1 : 0} roughness={0.4} />
        </mesh>
        {up && !dim && <Glow color={color} pos={[0, 0.9, 0]} size={0.34} opacity={0.6} />}
      </group>
      <LabelSprite name={device.name} detail={`${device.ip} · ${device.detail}`}
        pos={[0.04, 1.06, 0]} palette={palette} />
    </group>
  );
};

/** The line from the firewall to a pinned device — the firewall is what pings it. */
export const PingLink: React.FC<{ anchor: Vec3; device: PlacedUserDevice; palette: StagePalette; dim: boolean }> =
  ({ anchor, device, palette, dim }) => {
    const points = useMemo(
      () => arcPoints(anchor, { x: device.pos.x, y: device.pos.y + 0.12, z: device.pos.z }, 0.5, 20),
      [anchor, device.pos],
    );
    const color = statusColor(device.status, palette);
    const up = device.status === "up";
    // Kept deliberately THIN and quiet, always dashed: a ping line is "the firewall reaches this",
    // a different idea from a permitted-traffic path, so it must not compete with the config edges —
    // the device's own dot carries the up/down, this just traces who pings it.
    return (
      <Line points={points} color={color} lineWidth={up ? 1 : 0.9}
        transparent opacity={dim ? 0.05 : up ? 0.32 : 0.22}
        dashed dashSize={0.12} gapSize={0.1} />
    );
  };

