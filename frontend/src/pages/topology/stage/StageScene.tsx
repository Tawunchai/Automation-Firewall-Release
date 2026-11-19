import React, { useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { PlacedNode, StageLayout, Vec3 } from "./layout3d";
import { buildGrouping, routeEdges } from "./routing";
import type { PlacedUserDevice } from "./userDevices";
import type { StagePalette } from "./palette";
import type { TopoEdge } from "../model";
import type { EdgeActivity } from "../flowAnimation";
import { prefersReducedMotion } from "../flowAnimation";
import { CaptionSprite, Floor } from "./stage-primitives";
import { Chassis, Sockets, Tile } from "./stage-appliance";
import { PingLink, UserDevice } from "./stage-devices";
import { Cable, SplayLine, StageGroup, Trunk } from "./stage-edges";


// The stage itself. Everything here is presentation; WHAT is drawn and WHERE it stands was already
// decided by stageModel.ts and layout3d.ts, which have tests. This file has none, because a WebGL
// context cannot be asserted against in vitest — which is exactly why so little judgement lives
// in it.
//
// ── The look, and why ────────────────────────────────────────────────────────
// "Lit hardware on a quiet stage." The ring this replaces drew thirty identical grey boxes and ran
// colour through three jobs at once, so nothing read as more important than anything else. Here the
// stage is deliberately neutral — a soft floor wash, matte tiles, a dark chassis — so the few things
// that DO emit light (a port with a cable in it, a path with nothing inspecting it) are the only
// bright things on screen, and the eye lands on them first.

/**
 * Points the camera at the content instead of at the origin.
 *
 * The scene is not symmetric: the internet sits well outside the Outside lane, so a camera aimed at
 * 0,0,0 pushes the device a third of the way off screen and leaves the opposite third empty. A
 * firewall with no default route has no internet node at all, and a device with twelve zones is
 * deeper than one with two — all three want a different distance, so it is computed from the
 * layout's own bounds rather than tuned by hand for one lab device.
 */
const Framing: React.FC<{ bounds: StageLayout["bounds"]; controlsTarget: THREE.Vector3 }> =
  ({ bounds, controlsTarget }) => {
    const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
    const size = useThree((s) => s.size);
    const invalidate = useThree((s) => s.invalidate);

    // Framing keys off the SHAPE, not the object.
    //
    // The live stream delivers a sample every few seconds; each one rebuilds the topology, the
    // stage and the layout, so `bounds` arrives as a brand-new object with identical numbers. An
    // effect watching the object re-ran on every tick and snapped the camera back to its default —
    // the user could orbit and zoom, then watch it reset a few seconds later, over and over. A key
    // made of the numbers only changes when the diagram really does.
    const shape = `${bounds.center.x.toFixed(3)}|${bounds.center.z.toFixed(3)}`
      + `|${bounds.width.toFixed(3)}|${bounds.depth.toFixed(3)}`;

    useEffect(() => {
      const aspect = Math.max(size.width / Math.max(size.height, 1), 0.2);
      const vFov = (camera.fov * Math.PI) / 180;
      const halfV = Math.tan(vFov / 2);

      // A fairly shallow pitch: steep enough to read the faceplate, flat enough that the tiles keep
      // their thickness and the scene still looks like a room rather than a floor plan.
      const pitch = 0.62;

      // Depth is NOT a vertical measurement from a tilted camera — it is foreshortened by sin(pitch),
      // and the arcs' height contributes by cos(pitch). Fitting raw depth as if the camera looked
      // straight down stood it ~40% too far back and left the scene floating in an empty panel.
      // The trunks run LOW now (a bus at railY≈0.42, plus the raised VPN shelf at ~1.05), so the
      // scene no longer reserves the tall band the old bowing arcs needed — the camera pulls in.
      const ARC_HEIGHT = 1.3;
      const vExtent = bounds.depth * Math.sin(pitch) + ARC_HEIGHT * Math.cos(pitch);
      const fitV = vExtent / 2 / halfV;
      const fitH = bounds.width / 2 / (halfV * aspect);
      // Perspective widens whatever sits nearer than the target plane, so a fit computed at the
      // target distance alone crops the front row. The margin covers that and the orbit the user
      // can still do from here.
      const dist = Math.max(fitH, fitV) * 1.11;

      // Aimed a little above the floor, so the slack left over after fitting goes where the path
      // arcs are rather than onto empty floor below the device.
      const target = new THREE.Vector3(bounds.center.x, 1.15, bounds.center.z);
      camera.position.set(
        target.x,
        target.y + Math.sin(pitch) * dist,
        target.z + Math.cos(pitch) * dist,
      );
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      controlsTarget.copy(target);
      invalidate();
      // `bounds` is deliberately NOT a dependency — `shape` stands in for it. See above.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shape, camera, size.width, size.height, controlsTarget, invalidate]);

    return null;
  };

// ── Assembly ─────────────────────────────────────────────────────────────────

export type StageSceneProps = {
  layout: StageLayout;
  edges: TopoEdge[];
  palette: StagePalette;
  deviceName: string;
  captions: { fixed: string; numbered: string };
  activity: Map<string, EdgeActivity>;
  hover: string | null;
  onHover: (id: string | null) => void;
  onOpenNode: (node: PlacedNode) => void;
  onOpenSocket: (name: string) => void;
  onOpenEdge: () => void;
  /** The user's own pinned devices, already placed in front of the chassis (may be empty). */
  userDevices?: PlacedUserDevice[];
  /** Where the ping lines leave the chassis from. */
  userAnchor?: Vec3;
  /** Open the manage dialog for a pinned device. */
  onOpenUserDevice?: (id: number) => void;
};

const StageContents: React.FC<StageSceneProps> = ({
  layout, edges, palette, deviceName, captions, activity, hover,
  onHover, onOpenNode, onOpenSocket, onOpenEdge,
  userDevices = [], userAnchor, onOpenUserDevice,
}) => {
  const target = useMemo(() => new THREE.Vector3(0, 0.42, 0), []);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  // The config edges, routed into bundled trunks (firewall ↔ group) with per-edge splay. See
  // routing.ts: the tangle of per-edge arcs is gone, replaced by a hub-and-spoke whose line count is
  // bounded by the number of GROUPS, not the number of edges — which is what makes it scale.
  const grouping = useMemo(() => buildGrouping(layout), [layout]);
  const routed = useMemo(
    () => routeEdges(layout.egress, grouping, edges, activity, palette),
    [layout, grouping, edges, activity, palette],
  );

  /** Hovering a tile/trunk/group lights that group, its members and its jacks; nothing strobes. */
  const lit = useMemo(() => {
    if (!hover) return null;
    // A pinned device lights only itself and its ping line — both keyed "user:<id>".
    if (hover.startsWith("user:")) return new Set([hover]);
    const addGroupMembers = (gid: string, s: Set<string>) => {
      s.add(gid);
      grouping.groupOfNode.forEach((g, nodeId) => { if (g === gid) s.add(nodeId); });
    };
    // A hovered trunk → its whole group.
    const trunk = routed.trunks.find((t) => t.id === hover);
    if (trunk) { const s = new Set<string>([hover]); addGroupMembers(trunk.groupId, s); return s; }
    // A hovered group platform.
    if (layout.groups.some((g) => g.id === hover) || layout.internet?.id === hover) {
      const s = new Set<string>(); addGroupMembers(hover, s); return s;
    }
    // A hovered tile → itself, its group and its jacks.
    const node = layout.nodes.find((n) => n.id === hover)
      ?? (layout.internet?.id === hover ? layout.internet : undefined);
    if (node) return new Set([node.id, node.groupId, ...node.sockets].filter(Boolean));
    // A hovered edge's splay line.
    const path = routed.paths.get(hover);
    if (path) return new Set<string>([hover, ...path.groupIds]);
    // A hovered jack.
    const socket = layout.sockets.find((s) => s.name === hover);
    if (socket) return new Set([socket.name, socket.nodeId ?? ""].filter(Boolean));
    return null;
  }, [hover, layout, grouping, routed]);

  return (
    <>
      {/* Two rigs, not one dimmed: the light rig that reads as daylight over a white floor pushes
          every dark surface past its own colour, which had the dark theme's tiles coming back
          LIGHTER than the chassis they sit around. */}
      <ambientLight intensity={palette.dark ? 0.46 : 0.62} />
      <hemisphereLight args={[palette.floorEdge, palette.bg, palette.dark ? 0.3 : 0.45]} />
      <directionalLight position={[4.5, 9, 5.5]} intensity={palette.dark ? 0.66 : 0.8} />
      <directionalLight position={[-6, 4, -4]} intensity={palette.dark ? 0.16 : 0.24} />

      <Framing bounds={layout.bounds} controlsTarget={target} />
      <Floor palette={palette} center={layout.bounds.center}
        size={Math.max(layout.bounds.width, layout.bounds.depth) * 2.3} />
      <Chassis layout={layout} palette={palette} deviceName={deviceName} captions={captions} reduced={reduced} />
      <Sockets sockets={layout.sockets} palette={palette} lit={lit}
        onHover={onHover} onOpen={onOpenSocket} />

      {/* Faceplate looms: one thin cable per jack. */}
      {layout.trunks.map((t) => {
        const on = t.state === "up";
        const dim = lit !== null && !(lit.has(t.nodeId) || lit.has(t.socket));
        return (
          <Cable key={t.id} from={t.from} to={t.to}
            color={on ? palette.up : palette.down}
            width={on ? 1.9 : 1}
            opacity={dim ? 0.08 : on ? 0.8 : 0.26} />
        );
      })}

      {/* Group platforms, under the tiles. */}
      {layout.groups.map((g) => (
        <StageGroup key={g.id} group={g} palette={palette}
          dim={lit !== null && !lit.has(g.id)} />
      ))}

      {/* Bundled trunks — one low tube per group, labelled with the number of paths it carries.
          Hovering one lights its group, which also splays its individual paths over the top. */}
      {routed.trunks.map((t) => {
        const dim = lit !== null && !lit.has(t.groupId);
        return (
          <group key={t.id}>
            <Trunk trunk={t} dim={dim} reduced={reduced} onHover={onHover} onOpen={onOpenEdge} />
            {!dim && (
              <CaptionSprite text={String(t.count)}
                pos={[t.labelPos.x, t.labelPos.y, t.labelPos.z]} color={t.color} size={10} />
            )}
          </group>
        );
      })}

      {/* Splay: individual edge lines for a small group, or the group under the pointer. */}
      {[...routed.paths.values()].map((p) => {
        const [gf, gt] = p.groupIds;
        const show = routed.splayedGroups.has(gf) || routed.splayedGroups.has(gt)
          || (lit !== null && (lit.has(gf) || lit.has(gt)));
        if (!show) return null;
        const dim = lit !== null && !(lit.has(gf) || lit.has(gt) || lit.has(p.id));
        return (
          <group key={`sp-${p.id}`}
            onClick={(ev) => { ev.stopPropagation(); onOpenEdge(); }}
            onPointerOver={(ev) => { ev.stopPropagation(); onHover(p.id); }}
            onPointerOut={() => onHover(null)}>
            <SplayLine path={p} dim={dim} reduced={reduced} />
          </group>
        );
      })}

      {/* Tiles (nodes), on top of their platform. */}
      {layout.nodes.map((n) => (
        <Tile key={n.id} node={n} palette={palette}
          dim={lit !== null && !lit.has(n.id)}
          onHover={onHover} onOpen={() => onOpenNode(n)} />
      ))}

      {/* The internet: off-stage, beyond the Outside groups, its own node. */}
      {layout.internet && (
        <Tile key="internet" node={layout.internet} palette={palette}
          dim={lit !== null && !lit.has(layout.internet.id)}
          onHover={onHover} onOpen={() => { if (layout.internet) onOpenNode(layout.internet); }} />
      )}

      {/* The user's pinned devices and the firewall's ping line to each. */}
      {userAnchor && userDevices.map((d) => {
        const dim = lit !== null && !lit.has(`user:${d.id}`);
        return <PingLink key={`link-${d.id}`} anchor={userAnchor} device={d} palette={palette} dim={dim} />;
      })}
      {userDevices.map((d) => (
        <UserDevice key={`ud-${d.id}`} device={d} palette={palette}
          dim={lit !== null && !lit.has(`user:${d.id}`)}
          reduced={reduced}
          onHover={onHover} onOpen={() => onOpenUserDevice?.(d.id)} />
      ))}

      <OrbitControls
        enablePan={false}
        target={target}
        minDistance={4}
        maxDistance={26}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2.25}
        enableDamping={!reduced}
        makeDefault
      />
    </>
  );
};

const StageScene: React.FC<StageSceneProps> = (props) => {
  // Frames are burned only when something can actually move: measured traffic, OR any pinned device
  // (whose body idly floats and whose LEDs blink). A bare firewall scene with neither — the usual
  // state of a lab device — still renders on demand and costs no GPU at rest. Reduced-motion forces
  // demand regardless, so the idle animations never run for anyone who asked the OS to stop motion.
  const animated = useMemo(
    () => !prefersReducedMotion()
      && ([...props.activity.values()].some((t) => t > 0) || (props.userDevices?.length ?? 0) > 0),
    [props.activity, props.userDevices],
  );
  return (
    <div style={{ width: "100%", height: "100%", display: "block" }}>
      <Canvas
        camera={{ position: [0, 8, 13], fov: 36 }}
        frameloop={animated ? "always" : "demand"}
        gl={{ antialias: true, alpha: true }}
        style={{ background: props.palette.bg }}
      >
        <StageContents {...props} />
      </Canvas>
    </div>
  );
};

export default StageScene;
