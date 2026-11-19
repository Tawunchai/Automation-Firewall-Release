import * as THREE from "three";
import type { Vec3 } from "./layout3d";

// The two bits of geometry the stage is drawn with: the layout's own vector type as three.js wants
// it, and the lifted arc every cable and ping line follows.

export const V = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

/** A quadratic arc between two points. `lift` is how far over the straight line it bows. */
export const arcPoints = (a: Vec3, b: Vec3, lift: number, segments = 26): THREE.Vector3[] => {
  const mid = new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + lift, (a.z + b.z) / 2);
  return new THREE.QuadraticBezierCurve3(V(a), mid, V(b)).getPoints(segments);
};
