/**
 * The live court's camera: a broadcast position high in the side stand, a
 * little towards the near team's end, looking across the court — the view a
 * television gives a match. Court metres go in (`x` across, `y` along the
 * court with the net at 0 and the near team at negative `y`, `z` up) and
 * screen pixels come out, fitted so the court, both servers and a jump at the
 * net are always in shot. The near team plays on the left of the screen, the
 * far team on the right.
 */

export interface Projected {
  X: number;
  Y: number;
  /** Screen pixels per metre at that depth. */
  s: number;
  /** Distance along the line of sight — larger is further from the camera. */
  d: number;
}

export type Projector = (x: number, y: number, z: number) => Projected;

interface V3 {
  x: number;
  y: number;
  z: number;
}

/** In the side stand beyond the `+x` sideline, raised, and nudged towards the near end. */
export const CAMERA: Readonly<V3> = { x: 13.5, y: -2.4, z: 7.2 };
/** Where it points: just over the middle of the court. */
const TARGET: Readonly<V3> = { x: 0, y: 0.2, z: 0.6 };

/** What must be in shot: the court and the servers just behind each baseline,
 *  their reach above them, a block at the far end of the net and the near sideline. */
const FIT_PROBES: ReadonlyArray<readonly [number, number, number]> = [
  [-4.6, -9.9, 0], [4.6, -9.9, 0], [-4.6, 9.9, 0], [4.6, 9.9, 0],
  [0, -9.8, 2.6], [0, 9.8, 2.6],
  [-4.6, 0, 3.6], [5, 0, 0],
];

function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function unit(a: V3): V3 {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

/**
 * The camera as a pinhole: where it stands, where it looks, and — for a box
 * `width` × `height` — its focal length in pixels and the pixel the line of
 * sight passes through, fitted so the court sits inside the box: centred
 * across, and down towards the bottom, the way a broadcast frames the court
 * with the stand rising behind it. The 2D court projects with it, and the 3D
 * court builds its lens from it, so both frame the match alike.
 */
export interface CameraFit {
  position: Readonly<V3>;
  target: Readonly<V3>;
  /** Focal length, px. */
  focal: number;
  /** Where the line of sight meets the screen, px from the top-left corner. */
  cx: number;
  cy: number;
}

function basis(): { forward: V3; right: V3; up: V3 } {
  const forward = unit(sub(TARGET, CAMERA));
  const right = unit(cross(forward, { x: 0, y: 0, z: 1 }));
  return { forward, right, up: cross(right, forward) };
}

export function fitCamera(width: number, height: number, pad = 0.03): CameraFit {
  const { forward, right, up } = basis();
  const raw = (x: number, y: number, z: number): { X: number; Y: number } => {
    const v = sub({ x, y, z }, CAMERA);
    const d = Math.max(0.1, dot(v, forward));
    return { X: dot(v, right) / d, Y: -dot(v, up) / d };
  };
  const probes = FIT_PROBES.map(([x, y, z]) => raw(x, y, z));
  const minX = Math.min(...probes.map((p) => p.X));
  const maxX = Math.max(...probes.map((p) => p.X));
  const minY = Math.min(...probes.map((p) => p.Y));
  const maxY = Math.max(...probes.map((p) => p.Y));
  const focal = Math.min((width * (1 - 2 * pad)) / (maxX - minX), (height * (1 - 2 * pad)) / (maxY - minY));
  return {
    position: CAMERA,
    target: TARGET,
    focal,
    cx: width / 2 - ((minX + maxX) / 2) * focal,
    // Any room to spare goes above the court, to the stand.
    cy: height * (1 - pad) - maxY * focal,
  };
}

/** A projector for a `width` × `height` box, the court fitted inside it (see fitCamera). */
export function buildProjector(width: number, height: number, pad = 0.03): Projector {
  const { forward, right, up } = basis();
  const { focal, cx, cy } = fitCamera(width, height, pad);
  return (x, y, z) => {
    const v = sub({ x, y, z }, CAMERA);
    const d = Math.max(0.1, dot(v, forward));
    return { X: cx + (dot(v, right) / d) * focal, Y: cy + (-dot(v, up) / d) * focal, s: focal / d, d };
  };
}

/** The points the fit keeps in shot, for anyone checking it. */
export const IN_SHOT: ReadonlyArray<readonly [number, number, number]> = FIT_PROBES;
