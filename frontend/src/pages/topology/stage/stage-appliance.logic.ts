// socketTone: which colour a port on the drawn appliance takes, and whether it glows.
//
// A pure function of the socket and the palette, so it is not part of the 3D component that
// renders with it.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import type { PlacedSocket } from "./layout3d";
import type { StagePalette } from "./palette";

export const socketTone = (s: PlacedSocket, p: StagePalette): { body: string; glow: boolean } => {
  if (s.state === "up") return { body: p.up, glow: true };
  if (s.state === "unknown") return { body: p.unknown, glow: false };
  if (s.unused) return { body: p.bezel, glow: false };
  return { body: p.down, glow: false };
};
