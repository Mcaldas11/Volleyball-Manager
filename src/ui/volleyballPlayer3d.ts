/**
 * A volleyball player for close-ups: a young athlete in a royal-blue kit trimmed in yellow —
 * number 4 — standing in a T-pose, cut low-poly from surfaces of his own rather than boxes and
 * balls.
 *
 * Every part is traced through rings round its bone: the torso through the waist, the lats and
 * the chest, out to the shoulders and in to the neck; the arms through the deltoid, the biceps
 * and the forearm; the legs through the quads, the knee and the calf. Each ring is a rounded
 * square pushed out wherever a muscle is, and neighbouring rings are joined by flat triangles,
 * each painted one solid colour a shade lighter or darker than the next, so the planes read even
 * in soft light. The head is one sculpted surface — skull, brow, cheekbones, the jaw narrowing to
 * the chin — with a nose, ears, eyes under their lids, brows and lips on it, and short brown hair
 * swept up at the front laid over it in chunky planes. The prints — the number front and back,
 * the V-neck, the side panels, the stripes down the shorts, the cuffs, the laces — are cut into
 * the same surfaces, so the whole kit needs no texture.
 *
 * The same body, made a woman's — slimmer limbs and shoulders, a narrower waist, wider hips, a
 * bust, a softer jaw, her hair in a ponytail, a bun or a bob — plays the women's game; and in a
 * coach's clothes instead of the kit — a suit and tie, a shirt and tie, a tracksuit, a polo, with
 * trousers and smart shoes, a beard or glasses — either stands at the bench.
 *
 * The skeleton is playerRig.ts's: the same bones and the same body frame — `x` to the player's
 * right, `y` straight ahead, `z` up, the origin on the floor under the hips — with a group at
 * every joint, pivoting where the joint is, so the body can be posed joint by joint later on.
 * Each joint's pieces are one mesh, all sharing one material: about twenty draws for the player.
 */

import {
  BufferGeometry, Color, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Quaternion, ShapeUtils, Vector2, Vector3, type Material,
} from 'three';
import type { Body } from './courtMotion.ts';
import type { Look } from './figure3d.ts';
import { womensGame } from './gameGender.ts';
import { BONES, HIP_HEIGHT } from './playerRig.ts';

/** The player's colours. */
export interface PlayerColours {
  shirt: string;
  shorts: string;
  /** The collar, cuffs, side panels and stripes — in the game, the colour of the player's role. */
  trim: string;
  /** The number on the shirt. */
  number: string;
  pads: string;
  socks: string;
  shoe: string;
  sole: string;
  outsole: string;
  /** Inside the shoe's collar. */
  lining: string;
  skin: string;
  lips: string;
  hair: string;
  brows: string;
  eyes: string;
  iris: string;
  /** Lash lines, the line of the mouth. */
  ink: string;
}

/** Royal blue and yellow: the reference kit. */
export const KIT_FOUR: PlayerColours = {
  shirt: '#1f50b8', shorts: '#1f50b8', trim: '#f6c419', number: '#f6c419', pads: '#2a3448', socks: '#f2f2ee',
  shoe: '#2b5cc6', sole: '#f4f4f1',
  outsole: '#9aa3ae', lining: '#182039', skin: '#e2a680', lips: '#b9705d', hair: '#5a3822', brows: '#3a2416',
  eyes: '#f1ede6', iris: '#3c2718', ink: '#2a1911',
};

/** One side's limb joints, from the collarbone out and the hip down. */
export interface Limbs {
  shoulder: Group;
  upperArm: Group;
  forearm: Group;
  hand: Group;
  thigh: Group;
  shin: Group;
  foot: Group;
}

/** Every joint, each a group at its pivot. */
export interface PlayerJoints {
  hips: Group;
  torso: Group;
  neck: Group;
  head: Group;
  left: Limbs;
  right: Limbs;
}

export interface VolleyballPlayer {
  root: Group;
  joints: PlayerJoints;
}

/**
 * A coach's clothes instead of the kit: what is on the front of the top — a jacket's lapels over a
 * shirt and tie, a buttoned shirt and tie, a tracksuit's zip, a polo's buttons — whether its sleeves
 * run to the wrist, the shirt under a jacket, the tie. Trousers with them, and smart shoes.
 */
export interface Outfit {
  kind: 'jacket' | 'shirt' | 'zip' | 'polo';
  longSleeves: boolean;
  shirt: string;
  tie: string | null;
}

/** How far each leg is turned out in the T-pose, rad. */
export const LEG_SPREAD = 0.075;

const TAU = Math.PI * 2;
const IDENTITY = new Matrix4();

// ---- Facets --------------------------------------------------------------------------

/** A number in [0, 1) from an integer — the same every time. */
function hash(i: number): number {
  let h = Math.imul(i ^ 0x5bd1e995, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

const palette = new Map<string, Color>();

function colourOf(hex: string): Color {
  let c = palette.get(hex);
  if (c === undefined) {
    c = new Color(hex);
    palette.set(hex, c);
  }
  return c;
}

/** `a` taken `t` of the way to `b`. */
function mix(a: string, b: string, t: number): string {
  return `#${new Color(a).lerp(new Color(b), t).getHexString()}`;
}

/** A colour made darker (under 1) or lighter. */
function shade(hex: string, k: number): string {
  return `#${new Color(hex).multiplyScalar(k).getHexString()}`;
}

/** Flat triangles for one joint, each one solid colour a touch lighter or darker than the last. */
class Facets {
  private readonly position: number[] = [];
  private readonly colour: number[] = [];
  private faces = 0;
  private readonly e1 = new Vector3();
  private readonly e2 = new Vector3();

  constructor(private readonly seed: number) {}

  /** A triangle in `colour`, its shade varied by up to `vary` either way — turned to face `out`, if given. */
  tri(a: Vector3, b: Vector3, c: Vector3, colour: string, vary = 0.05, out?: Vector3): void {
    this.e1.subVectors(b, a);
    this.e2.subVectors(c, a);
    this.e1.cross(this.e2);
    if (this.e1.lengthSq() < 1e-14) return;
    if (out !== undefined && this.e1.dot(out) < 0) [b, c] = [c, b];
    this.position.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const k = 1 + (hash(this.seed * 7919 + this.faces++) * 2 - 1) * vary;
    const col = colourOf(colour);
    for (let i = 0; i < 3; i++) this.colour.push(col.r * k, col.g * k, col.b * k);
  }

  get empty(): boolean {
    return this.position.length === 0;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.position, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.colour, 3));
    // Unshared corners: every normal is its face's, for the shadows' offset.
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// ---- Surfaces ------------------------------------------------------------------------

/**
 * A cross-section `z` along the bone: `w` out to each side, `f` in front, `b` behind, about a
 * centre (`x`, `y`) off the bone; `n` how square it is — 2 an ellipse, higher boxier.
 */
interface Ring {
  z: number;
  w: number;
  f: number;
  b: number;
  x: number;
  y: number;
  n: number;
}

function R(z: number, w: number, f: number, b: number, y = 0, n = 2.3, x = 0): Ring {
  return { z, w, f, b, x, y, n };
}

/** The point at angle `a` round a ring: 0 out to the side (+x), a quarter turn in front (+y). */
function ringPoint(r: Ring, a: number, out = new Vector3()): Vector3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const e = 2 / r.n;
  return out.set(
    r.x + Math.sign(c) * Math.abs(c) ** e * r.w,
    r.y + Math.sign(s) * Math.abs(s) ** e * (s >= 0 ? r.f : r.b),
    r.z,
  );
}

/** The ring at `z`, between the two either side of it. */
function ringAt(rings: readonly Ring[], z: number): Ring {
  for (let i = 0; i + 1 < rings.length; i++) {
    const p = rings[i];
    const q = rings[i + 1];
    if (p.z !== q.z && (z - p.z) * (z - q.z) <= 0) {
      const t = (z - p.z) / (q.z - p.z);
      const l = (u: number, v: number): number => u + (v - u) * t;
      return { z, w: l(p.w, q.w), f: l(p.f, q.f), b: l(p.b, q.b), x: l(p.x, q.x), y: l(p.y, q.y), n: l(p.n, q.n) };
    }
  }
  const first = rings[0];
  const last = rings[rings.length - 1];
  return { ...(Math.abs(z - first.z) < Math.abs(z - last.z) ? first : last), z };
}

/** A smooth bump between `a` and `b` (either order), 1 halfway. */
function bump(t: number, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (t <= lo || t >= hi) return 0;
  return Math.sin(((t - lo) / (hi - lo)) * Math.PI);
}

/** How far round from straight ahead an angle is, 0 to π. */
function fromFront(a: number): number {
  return Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
}

/** Push a point straight out from its ring's centre. */
function pushOut(p: Vector3, a: number, amount: number): void {
  p.x += Math.cos(a) * amount;
  p.y += Math.sin(a) * amount;
}

/** Rings, and the muscles pushed out of them. */
interface Surface {
  rings: readonly Ring[];
  /** Push a point about — a muscle out, a side in — by its angle round the bone and its height. */
  shape?: (p: Vector3, a: number, z: number) => void;
}

/** The point at angle `a` round and `z` along — on the facets, not the curve, up and down the bone, so prints lie flat on them. */
function surfacePoint(s: Surface, a: number, z: number): Vector3 {
  const rings = s.rings;
  const at = (r: Ring): Vector3 => {
    const p = ringPoint(r, a);
    s.shape?.(p, a, r.z);
    return p;
  };
  for (let i = 0; i + 1 < rings.length; i++) {
    const p = rings[i];
    const q = rings[i + 1];
    if (p.z !== q.z && (z - p.z) * (z - q.z) <= 0) return at(p).lerp(at(q), (z - p.z) / (q.z - p.z));
  }
  return at(ringAt(rings, z));
}

/** Straight out from the bone through `p`. */
function outwardAt(s: Surface, p: Vector3, z: number): Vector3 {
  const r = ringAt(s.rings, z);
  return new Vector3(p.x - r.x, p.y - r.y, 0).normalize();
}

/** The angle round to the point `x` across, on the front (or the back) of the ring at `z`. */
function angleAcross(s: Surface, x: number, z: number, front: boolean): number {
  const r = ringAt(s.rings, z);
  const c = Math.sign(x - r.x) * Math.min(1, Math.abs(x - r.x) / r.w) ** (r.n / 2);
  const sn = Math.sqrt(Math.max(0, 1 - c * c));
  return Math.atan2(front ? sn : -sn, c);
}

/** The angle round to the point `h` above (or below) the centre, on the outer (+x) or inner side. */
function angleUp(s: Surface, h: number, z: number, outer: boolean): number {
  const r = ringAt(s.rings, z);
  const d = h - r.y;
  const sn = Math.sign(d) * Math.min(1, Math.abs(d) / (d >= 0 ? r.f : r.b)) ** (r.n / 2);
  const c = Math.sqrt(Math.max(0, 1 - sn * sn));
  return Math.atan2(sn, outer ? c : -c);
}

interface Loft extends Surface {
  /** Faces round each ring. */
  around: number;
  /** One colour, or a colour by band — band `i` runs from ring `i` to the next, -1 the start's cap — and angle. */
  colour: string | ((band: number, a: number) => string);
  vary?: number;
  /** Close the first or the last ring with a point this far beyond it along the bone. */
  start?: number;
  end?: number;
}

/**
 * Join the rings with flat triangles, the quads split on alternate diagonals so the facets
 * form a lattice rather than stripes. The rings may run either way along the bone; their
 * faces look out from it whichever way, and stay looking out through a fold — a hem turned in
 * to meet what is under it.
 */
function loft(out: Facets, s: Loft, m: Matrix4 = IDENTITY): void {
  const n = s.around;
  const rows = s.rings.map((r) => {
    const row: Vector3[] = [];
    for (let j = 0; j < n; j++) {
      const a = (j / n) * TAU;
      const p = ringPoint(r, a);
      s.shape?.(p, a, r.z);
      row.push(p.applyMatrix4(m));
    }
    return row;
  });
  const first = s.rings[0];
  const last = s.rings[s.rings.length - 1];
  const up = Math.sign(last.z - first.z) || 1;
  const flip = up * m.determinant() < 0;
  const colour = s.colour;
  const paint = (band: number, j: number): string =>
    typeof colour === 'string' ? colour : colour(band, ((j + 0.5) / n) * TAU);
  const tri = (p: Vector3, q: Vector3, r: Vector3, c: string): void => {
    if (flip) out.tri(p, r, q, c, s.vary);
    else out.tri(p, q, r, c, s.vary);
  };
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      const a0 = rows[i][j];
      const a1 = rows[i][k];
      const b0 = rows[i + 1][j];
      const b1 = rows[i + 1][k];
      const c = paint(i, j);
      if ((i + j) % 2 === 0) {
        tri(a0, a1, b1, c);
        tri(a0, b1, b0, c);
      } else {
        tri(a0, a1, b0, c);
        tri(a1, b1, b0, c);
      }
    }
  }
  if (s.start !== undefined) {
    const pole = new Vector3(first.x, first.y, first.z - up * s.start).applyMatrix4(m);
    for (let j = 0; j < n; j++) tri(rows[0][(j + 1) % n], rows[0][j], pole, paint(-1, j));
  }
  if (s.end !== undefined) {
    const pole = new Vector3(last.x, last.y, last.z + up * s.end).applyMatrix4(m);
    const row = rows[rows.length - 1];
    for (let j = 0; j < n; j++) tri(row[j], row[(j + 1) % n], pole, paint(rows.length - 1, j));
  }
}

/** Where a print's corner lands — and which way is out from there. */
type Placer = (u: number, v: number) => [Vector3, Vector3];

/** A point on a surface, lifted `lift` off it. */
function onSurface(s: Surface, a: number, z: number, lift: number): [Vector3, Vector3] {
  const p = surfacePoint(s, a, z);
  const o = outwardAt(s, p, z);
  return [p.addScaledVector(o, lift), o];
}

/** A flat outline printed on to a surface: its corners in the surface's own (u, v), split finer so it follows the curve. */
function print(
  out: Facets, outline: ReadonlyArray<readonly [number, number]>, at: Placer, colour: string,
  m: Matrix4 = IDENTITY, levels = 2, vary = 0.03,
): void {
  const contour = outline.map(([u, v]) => new Vector2(u, v));
  const put = (p: Vector2, q: Vector2, r: Vector2, level: number): void => {
    if (level > 0) {
      const pq = p.clone().lerp(q, 0.5);
      const qr = q.clone().lerp(r, 0.5);
      const rp = r.clone().lerp(p, 0.5);
      put(p, pq, rp, level - 1);
      put(pq, q, qr, level - 1);
      put(rp, qr, r, level - 1);
      put(pq, qr, rp, level - 1);
      return;
    }
    const [a] = at(p.x, p.y);
    const [b] = at(q.x, q.y);
    const [c] = at(r.x, r.y);
    const [, o] = at((p.x + q.x + r.x) / 3, (p.y + q.y + r.y) / 3);
    out.tri(a.applyMatrix4(m), b.applyMatrix4(m), c.applyMatrix4(m), colour, vary, o.transformDirection(m));
  };
  for (const [i, j, k] of ShapeUtils.triangulateShape(contour, [])) put(contour[i], contour[j], contour[k], levels);
}

/** A strip laid round a surface from angle `a0` to `a1`, between heights `lo(a)` and `hi(a)`. */
function band(
  out: Facets, s: Surface, a0: number, a1: number, lo: (a: number) => number, hi: (a: number) => number,
  colour: string, steps: number, rows = 1, lift = 0.003, m: Matrix4 = IDENTITY,
): void {
  const grid: Array<Array<[Vector3, Vector3]>> = [];
  for (let k = 0; k <= steps; k++) {
    const a = a0 + ((a1 - a0) * k) / steps;
    const col: Array<[Vector3, Vector3]> = [];
    for (let r = 0; r <= rows; r++) {
      const z = lo(a) + ((hi(a) - lo(a)) * r) / rows;
      const [p, o] = onSurface(s, a, z, lift);
      col.push([p.applyMatrix4(m), o.transformDirection(m)]);
    }
    grid.push(col);
  }
  for (let k = 0; k < steps; k++) {
    for (let r = 0; r < rows; r++) {
      const [p00, o] = grid[k][r];
      const [p10] = grid[k + 1][r];
      const [p01] = grid[k][r + 1];
      const [p11] = grid[k + 1][r + 1];
      out.tri(p00, p10, p11, colour, 0.03, o);
      out.tri(p00, p11, p01, colour, 0.03, o);
    }
  }
}

/** A low-poly ellipsoid. */
function blob(
  out: Facets, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, colour: string, around = 10, slices = 5,
  m: Matrix4 = IDENTITY,
): void {
  const rings: Ring[] = [];
  for (let i = 1; i < slices; i++) {
    const t = (i / slices) * Math.PI;
    const s = Math.sin(t);
    rings.push(R(cz - rz * Math.cos(t), rx * s, ry * s, ry * s, cy, 2, cx));
  }
  const pole = rz * (1 - Math.cos(Math.PI / slices));
  loft(out, { rings, around, colour, start: pole, end: pole }, m);
}

/** A rectangle's corners, for `print`. */
function rect(u0: number, v0: number, u1: number, v1: number): Array<[number, number]> {
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
}

// ---- The torso -----------------------------------------------------------------------

/** The shirt, from the hem — turned in to meet the shorts — up to the neckline, turned in to meet the neck. */
const SHIRT: Surface = {
  rings: [
    R(-0.125, 0.18, 0.112, 0.118, 0, 2.6),
    R(-0.13, 0.192, 0.125, 0.13, 0, 2.6),
    R(-0.06, 0.182, 0.118, 0.122, 0, 2.6),
    R(0.04, 0.17, 0.114, 0.112, 0, 2.6),
    R(0.15, 0.173, 0.12, 0.11, 0, 2.6),
    R(0.27, 0.186, 0.128, 0.116, 0, 2.6),
    R(0.37, 0.198, 0.133, 0.118, 0, 2.6),
    R(0.44, 0.207, 0.125, 0.114, 0, 2.6),
    R(0.5, 0.211, 0.104, 0.104, 0, 2.6),
    R(0.545, 0.15, 0.08, 0.085, 0, 2.4),
    R(0.575, 0.078, 0.066, 0.066, 0, 2.2),
    R(0.56, 0.063, 0.054, 0.058, 0, 2.2),
  ],
  shape: (p, a, z) => {
    const x = Math.abs(p.x);
    if (Math.sin(a) > 0) p.y += 0.011 * bump(z, 0.27, 0.46) * bump(x, 0.0, 0.18);
    else p.y -= 0.008 * bump(z, 0.28, 0.5) * bump(x, 0.02, 0.17);
  },
};

/** Where the V of the neck dips to at the front, and how far round it spreads. */
const V_DEPTH = 0.522;
const V_SPREAD = 0.5;
const NECKLINE = 0.572;

function collarTop(a: number): number {
  const off = fromFront(a);
  return off < V_SPREAD ? V_DEPTH + (NECKLINE - V_DEPTH) * (off / V_SPREAD) : NECKLINE;
}

/**
 * The shirt's digits, in blocks in a box a unit wide and 1.4 tall — the top, the right above and
 * below the middle, the bottom, the left below and above, the middle bar — so a 4 is open at the
 * top, as a kit's is. A 1 is a stem with a flag.
 */
const BLOCKS: Record<string, readonly [number, number, number, number]> = {
  a: [0, 1.15, 1, 1.4], b: [0.75, 0.7, 1, 1.4], c: [0.75, 0, 1, 0.7], d: [0, 0, 1, 0.25],
  e: [0, 0, 0.25, 0.7], f: [0, 0.7, 0.25, 1.4], g: [0, 0.575, 1, 0.825],
};
const DIGITS = ['abcdef', '', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
const ONE: ReadonlyArray<readonly [number, number, number, number]> = [[0.42, 0, 0.67, 1.4], [0.17, 1.15, 0.42, 1.4]];

/** The blocks of one digit. */
function digitBlocks(d: number): ReadonlyArray<readonly [number, number, number, number]> {
  return d === 1 ? ONE : [...DIGITS[d]].map((k) => BLOCKS[k]);
}

/**
 * A number printed `height` tall from `bottom` up, centred: `mirror` -1 on the front, where the
 * reader's left is the player's right, 1 on the back. Two digits are each a little narrower.
 */
function printNumber(out: Facets, n: number, at: Placer, mirror: number, bottom: number, height: number, colour: string): void {
  const digits = [...String(n)].map(Number);
  const unit = height / 1.4;
  const wide = digits.length > 1 ? unit * 0.82 : unit;
  const gap = unit * 0.22;
  const total = digits.length * wide + (digits.length - 1) * gap;
  digits.forEach((d, k) => {
    const left = -total / 2 + k * (wide + gap);
    for (const [u0, v0, u1, v1] of digitBlocks(d)) {
      const outline = rect(left + u0 * wide, bottom + v0 * unit, left + u1 * wide, bottom + v1 * unit);
      // One flat colour, so where two blocks overlap nothing shows.
      print(out, outline.map(([u, v]) => [mirror * u, v]), at, colour, IDENTITY, 2, 0);
    }
  });
}

function buildTorso(out: Facets, s: Shapes, c: PlayerColours, number: number): void {
  const last = s.shirt.rings.length - 2;
  loft(out, {
    ...s.shirt, around: 16, vary: 0.045,
    // The turned-in neckline: the collar's inside, but skin in the V.
    colour: (bandIndex, a) => (bandIndex === last ? (fromFront(a) < V_SPREAD ? c.skin : c.trim) : c.shirt),
  });
  // Front and back: a point `x` across at height `z`, lifted off the shirt.
  const front = (lift: number): Placer => (u, v) => onSurface(s.shirt, angleAcross(s.shirt, u, v, true), v, lift);
  const back = (lift: number): Placer => (u, v) => onSurface(s.shirt, angleAcross(s.shirt, u, v, false), v, lift);
  // The number, with a bar under it; bigger on the back.
  if (number > 0) {
    printNumber(out, number, front(0.004), -1, 0.22, 0.145, c.number);
    print(out, rect(-0.042, 0.193, 0.042, 0.204), front(0.004), c.trim, IDENTITY, 2);
    printNumber(out, number, back(0.004), 1, 0.17, 0.2, c.number);
  }
  // The crest over the heart, and two flashes on the other side.
  print(out, rect(-0.122, 0.402, -0.088, 0.43), front(0.004), c.trim, IDENTITY, 2);
  print(out, rect(0.088, 0.404, 0.124, 0.412), front(0.004), c.trim, IDENTITY, 1);
  print(out, rect(0.088, 0.419, 0.124, 0.427), front(0.004), c.trim, IDENTITY, 1);
  // The collar, and the skin in its V.
  band(out, s.shirt, 0, TAU, (a) => collarTop(a) - 0.024, collarTop, c.trim, 48, 1, 0.003);
  band(out, s.shirt, Math.PI / 2 - V_SPREAD, Math.PI / 2 + V_SPREAD, collarTop, () => 0.574, c.skin, 16, 2, 0.0035);
  // A panel down each side, from under the arm to the hem, a darker edge either side of it.
  for (const mid of [0, Math.PI]) {
    band(out, s.shirt, mid - 0.15, mid + 0.15, () => -0.122, () => 0.43, c.trim, 3, 8, 0.003);
    for (const [a0, a1] of [[mid - 0.19, mid - 0.15], [mid + 0.15, mid + 0.19]]) {
      band(out, s.shirt, a0, a1, () => -0.122, () => 0.43, shade(c.shirt, 0.7), 1, 8, 0.003);
    }
  }
}

/** A collar standing round the neck, turned in at its top. */
const COLLAR: Surface = {
  rings: [R(0.546, 0.073, 0.065, 0.067, 0, 2.2), R(0.588, 0.066, 0.058, 0.062, -0.002, 2.2), R(0.588, 0.06, 0.052, 0.057, -0.002, 2.2)],
};

/** A coach's top on the same torso: no number, no panels — a collar, and its front. */
function buildTop(out: Facets, s: Shapes, c: PlayerColours, o: Outfit): void {
  const top = c.shirt;
  // A jacket shows the shirt's collar; a polo's is in the second colour.
  const collar = o.kind === 'jacket' ? o.shirt : o.kind === 'polo' ? c.trim : top;
  const last = s.shirt.rings.length - 2;
  // A shirt or a polo tucked into the trousers, belted: below the belt the hips are the trousers'.
  const tucked = o.kind === 'shirt' || o.kind === 'polo';
  loft(out, {
    ...s.shirt, around: 16, vary: 0.04,
    colour: (bandIndex) => (bandIndex === last ? collar : tucked && bandIndex <= 1 ? c.shorts : top),
  });
  loft(out, { ...s.collar, around: 16, vary: 0.04, colour: collar });
  const front = (lift: number): Placer => (u, v) => onSurface(s.shirt, angleAcross(s.shirt, u, v, true), v, lift);
  const button = (z: number, colour: string, r = 0.0042): void =>
    print(out, rect(-r, z - r, r, z + r), front(0.0048), colour, IDENTITY, 0, 0);
  if (tucked) {
    band(out, s.shirt, 0, TAU, () => -0.074, () => -0.052, shade(c.shoe, 0.95), 32, 1, 0.003);
    print(out, rect(-0.012, -0.075, 0.012, -0.051), front(0.0045), '#b8bec8', IDENTITY, 0, 0);
  }
  // The knot under the collar, then the blade down to its point at `to`.
  const tie = (to: number): void => {
    if (o.tie === null) return;
    print(out, [[-0.012, 0.547], [0.012, 0.547], [0.008, 0.524], [-0.008, 0.524]], front(0.0058), shade(o.tie, 0.88), IDENTITY, 1, 0.02);
    print(out, [[-0.008, 0.524], [0.008, 0.524], [0.021, to + 0.03], [0, to], [-0.021, to + 0.03]], front(0.0052), o.tie, IDENTITY, 2, 0.03);
  };
  switch (o.kind) {
    case 'jacket': {
      // The shirt in the V of the lapels, the tie down it, the lapels' edges, two buttons below.
      const tip = 0.36;
      print(out, [[-0.074, 0.553], [0.074, 0.553], [0, tip]], front(0.0035), o.shirt, IDENTITY, 2, 0.02);
      tie(tip + 0.012);
      for (const side of [1, -1]) {
        print(out, [[side * 0.074, 0.553], [side * 0.106, 0.536], [side * 0.012, tip - 0.022], [0, tip]], front(0.0042), shade(top, 0.8), IDENTITY, 2, 0.03);
      }
      for (const z of [0.31, 0.235]) button(z, shade(top, 0.55), 0.005);
      // The breast pocket.
      print(out, rect(-0.135, 0.405, -0.088, 0.413), front(0.0038), shade(top, 0.72), IDENTITY, 1, 0);
      // The skirt of the jacket, on down over the hips from the hem: its fronts meeting down the
      // middle below the buttons, a flap over a pocket each side.
      const hem = s.shirt.rings[1];
      const skirt: Surface = {
        rings: [
          R(-0.12, hem.w * 0.99, hem.f * 0.99, hem.b * 0.99, 0, hem.n), R(-0.2, hem.w * 1.04, hem.f * 1.01, hem.b * 1.05, 0, hem.n),
          R(-0.235, hem.w * 1.05, hem.f * 1.02, hem.b * 1.06, 0, hem.n), R(-0.235, hem.w * 0.95, hem.f * 0.9, hem.b * 0.92, 0, hem.n),
        ],
      };
      loft(out, { ...skirt, around: 16, vary: 0.04, colour: (bandIndex) => (bandIndex === 2 ? shade(top, 0.85) : top) });
      const onSkirt = (lift: number): Placer => (u, v) => onSurface(skirt, angleAcross(skirt, u, v, true), v, lift);
      print(out, rect(-0.0025, -0.232, 0.0025, -0.12), onSkirt(0.003), shade(top, 0.5), IDENTITY, 1, 0);
      for (const side of [1, -1]) print(out, rect(side * 0.055, -0.168, side * 0.135, -0.156), onSkirt(0.0035), shade(top, 0.72), IDENTITY, 1, 0);
      break;
    }
    case 'shirt':
      print(out, rect(-0.0028, -0.05, 0.0028, 0.546), front(0.0036), shade(top, 0.88), IDENTITY, 2, 0);
      for (const z of [0.18, 0.26, 0.34, 0.42, 0.5]) button(z, shade(top, 0.78), 0.0032);
      tie(0.205);
      break;
    case 'zip':
      // The second colour over the shoulders, and the zip up the front to the collar.
      band(out, s.shirt, 0, TAU, () => 0.468, () => 0.546, c.trim, 40, 1, 0.003);
      print(out, rect(-0.0032, -0.122, 0.0032, 0.56), front(0.0042), lightness(top) > 0.45 ? '#2a2f38' : '#d9dde3', IDENTITY, 2, 0);
      print(out, rect(-0.006, 0.51, 0.006, 0.536), front(0.005), '#c0c4cc', IDENTITY, 0, 0);
      break;
    default:
      // A polo's placket, and its two buttons.
      print(out, rect(-0.016, 0.468, 0.016, 0.55), front(0.0035), shade(top, 0.9), IDENTITY, 1, 0);
      for (const z of [0.524, 0.495]) button(z, lightness(top) > 0.45 ? '#2a2f38' : '#e6e9ee', 0.0036);
  }
}

// ---- The hips ------------------------------------------------------------------------

const SHORTS: Surface = {
  rings: [
    R(-0.13, 0.11, 0.075, 0.08, 0, 2.4),
    R(-0.1, 0.17, 0.1, 0.11, 0, 2.4),
    R(-0.05, 0.182, 0.108, 0.122, 0, 2.4),
    R(0.02, 0.172, 0.105, 0.116, 0, 2.4),
    R(0.1, 0.15, 0.1, 0.1, 0, 2.4),
  ],
  // The glutes.
  shape: (p, a, z) => {
    if (Math.sin(a) < 0) p.y -= 0.012 * bump(z, -0.11, 0.05) * bump(Math.abs(p.x), 0.01, 0.16);
  },
};

function buildHips(out: Facets, s: Shapes, c: PlayerColours, trousers: boolean): void {
  loft(out, { ...s.shorts, around: 16, colour: c.shorts, start: 0.02 });
  if (trousers) return;
  // The stripes, down from the waist to where the shorts turn in between the legs.
  const low = s.shorts.rings[1].z + 0.004;
  for (const mid of [0, Math.PI]) band(out, s.shorts, mid - 0.13, mid + 0.13, () => low, () => 0.06, c.trim, 2, 3, 0.003);
}

// ---- The legs, built as the right one; the left is its mirror --------------------------

const SHORTS_LEG: Surface = {
  rings: [
    R(0, 0.085, 0.09, 0.095),
    R(-0.06, 0.098, 0.1, 0.106),
    R(-0.2, 0.094, 0.096, 0.1),
    R(-0.315, 0.09, 0.092, 0.095),
    R(-0.315, 0.07, 0.075, 0.07),
  ],
};

const THIGH: Surface = {
  rings: [
    R(-0.25, 0.074, 0.08, 0.074),
    R(-0.34, 0.069, 0.077, 0.067),
    R(-0.4, 0.062, 0.07, 0.058),
    R(-0.44, 0.056, 0.061, 0.053),
    R(-0.48, 0.052, 0.055, 0.05),
  ],
  // The teardrop of the quad over the inside of the knee, and the one down the outside.
  shape: (p, a, z) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    if (c < 0 && s > -0.3) pushOut(p, a, 0.008 * bump(z, -0.33, -0.46) * -c);
    if (c > 0 && s > -0.2) pushOut(p, a, 0.004 * bump(z, -0.24, -0.4) * c);
  },
};

const PAD: Surface = {
  rings: [
    R(0.078, 0.066, 0.073, 0.062),
    R(0.072, 0.07, 0.078, 0.067),
    R(0.035, 0.07, 0.081, 0.065),
    R(-0.01, 0.068, 0.082, 0.066),
    R(-0.055, 0.065, 0.074, 0.073),
    R(-0.09, 0.062, 0.068, 0.081),
    R(-0.095, 0.057, 0.06, 0.076),
  ],
};

/** The shin and calf, down into the shoe; the sock starts at the turned-out step. */
const SHIN: Surface = {
  rings: [
    R(0.03, 0.052, 0.055, 0.052),
    R(-0.03, 0.054, 0.052, 0.062),
    R(-0.09, 0.056, 0.05, 0.075),
    R(-0.15, 0.055, 0.048, 0.079),
    R(-0.21, 0.05, 0.046, 0.068),
    R(-0.265, 0.044, 0.043, 0.055),
    R(-0.265, 0.048, 0.047, 0.059),
    R(-0.33, 0.042, 0.045, 0.046),
    R(-0.4, 0.036, 0.041, 0.039),
    R(-0.45, 0.035, 0.043, 0.04),
    R(-0.485, 0.034, 0.046, 0.042),
  ],
  // The calf's inner head sits lower and fuller than the outer.
  shape: (p, a, z) => {
    const c = Math.cos(a);
    if (Math.sin(a) < 0) pushOut(p, a, (c < 0 ? 0.007 * bump(z, -0.08, -0.26) : 0.003 * bump(z, -0.08, -0.21)) * Math.abs(c));
  },
};
const SOCK_BAND = 5;

/** The shoe, heel to toe: rings along the foot (their `z` is how far forward, `y` the height of their middle). */
const SHOE: Surface = {
  rings: [
    R(-0.078, 0.03, 0.022, 0.025, -0.058, 3.2),
    R(-0.064, 0.043, 0.06, 0.05, -0.035, 3.2),
    R(-0.02, 0.049, 0.07, 0.045, -0.04, 3.2),
    R(0.04, 0.053, 0.045, 0.04, -0.045, 3.2),
    R(0.11, 0.057, 0.025, 0.03, -0.055, 3.2),
    R(0.17, 0.055, 0.018, 0.025, -0.06, 3.2),
    R(0.215, 0.045, 0.013, 0.021, -0.064, 3.2),
    R(0.236, 0.026, 0.008, 0.015, -0.068, 3.2),
  ],
};
/** Lays the shoe's rings along the foot: their `z` forward, their `y` up. */
const ALONG_FOOT = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1);

/** The swoosh down each side of the shoe: (forward, height) — heel high, sweeping down to the toe. */
const SHOE_STRIPE: ReadonlyArray<readonly [number, number]> = [
  [-0.045, -0.032], [0.02, -0.046], [0.12, -0.063], [0.175, -0.066], [0.165, -0.058], [0.1, -0.051], [0.02, -0.032],
  [-0.04, -0.02],
];

/** A trouser leg, hip to knee, and on down from the knee to the hem over the shoe — turned in there. */
const TROUSER_THIGH: Surface = {
  rings: [
    R(0, 0.085, 0.09, 0.095),
    R(-0.06, 0.093, 0.096, 0.1),
    R(-0.2, 0.087, 0.09, 0.092),
    R(-0.34, 0.077, 0.082, 0.076),
    R(-0.44, 0.068, 0.072, 0.066),
    R(-0.5, 0.064, 0.068, 0.064),
  ],
};
const TROUSER_SHIN: Surface = {
  rings: [
    R(0.045, 0.066, 0.07, 0.066),
    R(-0.08, 0.063, 0.064, 0.072),
    R(-0.2, 0.059, 0.06, 0.068),
    R(-0.33, 0.055, 0.057, 0.058),
    R(-0.45, 0.055, 0.06, 0.058),
    R(-0.462, 0.056, 0.062, 0.06),
    R(-0.462, 0.04, 0.046, 0.044),
  ],
};

/**
 * Down a trouser leg: a tracksuit's stripe in its second colour down the outside, or a smart pair's
 * crease down the front.
 */
function trouserLines(out: Facets, leg: Surface, c: PlayerColours, o: Outfit, m: Matrix4): void {
  const rings = leg.rings;
  const [from, to] = [rings[0].z, rings[rings.length - 1].z + 0.004];
  if (o.kind === 'zip') band(out, leg, -0.1, 0.1, () => to, () => from, c.trim, 2, 6, 0.003, m);
  else if (o.kind !== 'polo') band(out, leg, Math.PI / 2 - 0.025, Math.PI / 2 + 0.025, () => to, () => from, shade(c.shorts, 1.3), 1, 6, 0.0025, m);
}

function buildThigh(out: Facets, s: Shapes, c: PlayerColours, m: Matrix4, left: boolean, o?: Outfit): void {
  if (o !== undefined) {
    loft(out, { ...s.trouserThigh, around: 12, colour: c.shorts, vary: 0.04 }, m);
    trouserLines(out, s.trouserThigh, c, o, m);
    return;
  }
  loft(out, { ...s.shortsLeg, around: 12, colour: c.shorts, vary: 0.045 }, m);
  const hem = s.shortsLeg.rings[s.shortsLeg.rings.length - 1].z;
  band(out, s.shortsLeg, -0.14, 0.14, () => hem + 0.003, () => 0.0, c.trim, 2, 5, 0.003, m);
  // The maker's flash on the left leg, just over the hem.
  if (left) {
    const at: Placer = (u, v) => onSurface(s.shortsLeg, angleAcross(s.shortsLeg, u, v, true), v, 0.003);
    print(out, rect(0.025, hem + 0.03, 0.058, hem + 0.053), at, c.trim, m, 1);
  }
  loft(out, { ...s.thigh, around: 10, colour: c.skin, vary: 0.04, end: 0.01 }, m);
}

function buildShin(out: Facets, s: Shapes, c: PlayerColours, m: Matrix4, o?: Outfit): void {
  if (o !== undefined) {
    loft(out, { ...s.trouserShin, around: 12, colour: c.shorts, vary: 0.04 }, m);
    // Short of the turned-in hem.
    trouserLines(out, { rings: s.trouserShin.rings.slice(0, -1) }, c, o, m);
    // Under the hem, the socks down into the shoes.
    loft(out, { rings: s.shin.rings.filter((r) => r.z <= -0.33), around: 10, colour: c.socks, vary: 0.04, end: 0.005 }, m);
    return;
  }
  const pad = s.pad.rings.length - 2;
  loft(out, { ...s.pad, around: 12, colour: (i) => (i === 0 || i === pad ? '#1c2434' : c.pads), vary: 0.06 }, m);
  loft(out, { ...s.shin, around: 10, colour: (i) => (i >= SOCK_BAND ? c.socks : c.skin), vary: 0.04, start: 0.01, end: 0.005 }, m);
}

/** A court shoe — white toe, heel, laces and swoosh — or, `sporty` false, a plain smart one. */
function buildFoot(out: Facets, s: Shapes, c: PlayerColours, foot: Matrix4, sporty: boolean): void {
  // A woman's a little smaller, about the ankle.
  const m = foot.clone().multiply(new Matrix4().makeScale(s.foot[0], s.foot[1], 1));
  const place = m.clone().multiply(ALONG_FOOT);
  const last = SHOE.rings.length - 1;
  loft(out, {
    ...SHOE, around: 12, vary: 0.05, start: 0.006, end: 0.008,
    colour: (i, a) => {
      const s = Math.sin(a);
      if (s < -0.9) return c.outsole;
      if (s < -0.5) return c.sole;
      if (!sporty) return c.shoe;
      // A white toe bumper, and a white heel.
      if ((i === last || i === last - 1) && s < 0.3) return c.sole;
      if (i === -1 || (i === 0 && s < 0.5)) return c.sole;
      return c.shoe;
    },
  }, place);
  // Laces over the instep.
  const top: Placer = (u, v) => onSurface(SHOE, angleAcross(SHOE, u, v, true), v, 0.003);
  for (const y of [0.03, 0.055, 0.08, 0.105]) print(out, rect(-0.022, y, 0.022, y + 0.009), top, sporty ? c.sole : shade(c.shoe, 0.7), place, 1);
  // The swoosh down both sides.
  for (const outer of sporty ? [true, false] : []) {
    const side: Placer = (u, v) => onSurface(SHOE, angleUp(SHOE, v, u, outer), u, 0.0025);
    print(out, SHOE_STRIPE, side, c.sole, place, 1);
  }
  // The collar's lining, round the ankle: lower at the front, as the shoe's opening is.
  loft(out, {
    rings: [R(0.008, 0.05, 0.066, 0.062), R(0.016, 0.037, 0.045, 0.041)],
    shape: (p) => { p.z -= 0.3 * p.y; },
    around: 12, colour: c.lining, vary: 0.04,
  }, m);
}

// ---- The arms, built as the right one hanging down — palm in, thumb forward ------------

const SLEEVE: Surface = {
  // A dome over the joint: when the arm hangs it is the top of the shoulder, raised it tucks into the torso.
  rings: [
    R(0.05, 0.028, 0.032, 0.032),
    R(0.02, 0.058, 0.062, 0.06),
    R(-0.02, 0.068, 0.07, 0.068),
    R(-0.07, 0.07, 0.07, 0.068),
    R(-0.12, 0.066, 0.067, 0.064),
    R(-0.148, 0.065, 0.066, 0.063),
    R(-0.168, 0.064, 0.065, 0.062),
    R(-0.168, 0.052, 0.056, 0.054),
  ],
  // The deltoid, under the cloth.
  shape: (p, a, z) => {
    const c = Math.cos(a);
    if (c > 0) pushOut(p, a, 0.006 * bump(z, 0.05, -0.12) * c);
  },
};
const CUFF_BAND = 5;

const UPPER_ARM: Surface = {
  rings: [
    R(-0.1, 0.052, 0.054, 0.053),
    R(-0.17, 0.051, 0.059, 0.056),
    R(-0.24, 0.049, 0.056, 0.052),
    R(-0.3, 0.045, 0.047, 0.046),
    R(-0.345, 0.042, 0.042, 0.044),
    R(-0.375, 0.04, 0.04, 0.045, -0.003),
  ],
  // The biceps in front, below the sleeve; the triceps behind, a little higher.
  shape: (p, a, z) => {
    const s = Math.sin(a);
    if (s > 0) pushOut(p, a, 0.004 * bump(z, -0.16, -0.33) * s);
    else pushOut(p, a, 0.003 * bump(z, -0.15, -0.3) * -s);
  },
};

const FOREARM: Surface = {
  rings: [
    R(0.03, 0.039, 0.04, 0.043, -0.002),
    R(-0.03, 0.045, 0.046, 0.046),
    R(-0.085, 0.047, 0.045, 0.042),
    R(-0.15, 0.04, 0.039, 0.036),
    R(-0.22, 0.031, 0.034, 0.03),
    R(-0.27, 0.022, 0.031, 0.028),
    R(-0.31, 0.019, 0.028, 0.026),
  ],
  // The muscle over the top of the forearm, on the thumb side.
  shape: (p, a, z) => {
    if (Math.sin(a) > 0 && Math.cos(a) > -0.3) pushOut(p, a, 0.004 * bump(z, -0.01, -0.15));
  },
};

const PALM: Surface = {
  rings: [
    R(0.012, 0.017, 0.03, 0.03, 0, 3),
    R(-0.02, 0.019, 0.037, 0.036, 0, 3),
    R(-0.06, 0.018, 0.043, 0.042, 0, 3),
    R(-0.09, 0.015, 0.044, 0.043, 0, 3),
  ],
  // The ball of the thumb, on the palm.
  shape: (p, a, z) => {
    if (Math.cos(a) < 0 && Math.sin(a) > 0) pushOut(p, a, 0.005 * bump(z, 0.0, -0.065));
  },
};

/** Index to little finger: across the palm, how long, how thick, and how far each fans out. */
const FINGERS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.031, 0.072, 0.0092, 0.05],
  [0.0105, 0.081, 0.0095, 0.01],
  [-0.0105, 0.076, 0.009, -0.04],
  [-0.0305, 0.06, 0.008, -0.1],
];

/** A finger, from its knuckle: three joints' worth of tapering, the tip rounded off. */
function finger(length: number, r: number, colour: string): Loft {
  return {
    rings: [
      R(0.006, r * 0.9, r, r),
      R(-length * 0.4, r * 0.88, r * 0.95, r * 0.95),
      R(-length * 0.75, r * 0.8, r * 0.85, r * 0.85),
      R(-length, r * 0.66, r * 0.7, r * 0.7),
    ],
    around: 6, colour, vary: 0.04, end: r * 0.6,
  };
}

function buildShoulder(out: Facets, s: Shapes, c: PlayerColours, side: number): void {
  // The cloth over the deltoid, round the joint.
  const k = s.shoulder;
  blob(out, side * (BONES.shoulderOut - 0.058), 0, 0.012, 0.058 * k, 0.062 * k, 0.05 * k, c.shirt);
}

/** A long sleeve, on down from the short one to the elbow, and from the elbow to its cuff at the wrist. */
const SLEEVE_TO_ELBOW: Surface = {
  rings: [R(-0.1, 0.062, 0.064, 0.063), R(-0.2, 0.06, 0.064, 0.062), R(-0.3, 0.055, 0.056, 0.056), R(-0.38, 0.05, 0.05, 0.054, -0.002)],
};
const SLEEVE_TO_WRIST: Surface = {
  rings: [
    R(0.04, 0.05, 0.052, 0.055),
    R(-0.03, 0.053, 0.054, 0.054),
    R(-0.1, 0.052, 0.051, 0.049),
    R(-0.18, 0.046, 0.046, 0.044),
    R(-0.24, 0.04, 0.042, 0.04),
    R(-0.275, 0.036, 0.04, 0.038),
    R(-0.275, 0.026, 0.033, 0.031),
  ],
};
const WRIST_CUFF = 4;

function buildUpperArm(out: Facets, s: Shapes, c: PlayerColours, m: Matrix4, o?: Outfit): void {
  const long = o?.longSleeves === true;
  loft(out, { ...s.sleeve, around: 12, colour: (i) => (i >= CUFF_BAND && !long ? c.trim : c.shirt), vary: 0.045 }, m);
  if (long) loft(out, { ...s.sleeveToElbow, around: 12, colour: c.shirt, vary: 0.04, end: 0.012 }, m);
  else loft(out, { ...s.upperArm, around: 10, colour: c.skin, vary: 0.04, end: 0.012 }, m);
  // A tracksuit's stripe down the outside of the sleeve, from the shoulder.
  if (o?.kind === 'zip') {
    band(out, s.sleeve, -0.13, 0.13, () => -0.165, () => 0.02, c.trim, 2, 4, 0.003, m);
    band(out, s.sleeveToElbow, -0.13, 0.13, () => -0.375, () => -0.1, c.trim, 2, 4, 0.003, m);
  }
}

function buildForearm(out: Facets, s: Shapes, c: PlayerColours, m: Matrix4, o?: Outfit): void {
  loft(out, { ...s.forearm, around: 10, colour: c.skin, vary: 0.04, start: 0.01, end: 0.004 }, m);
  if (o?.longSleeves !== true) return;
  // At the wrist: the shirt's cuff out of a jacket's sleeve, a tracksuit's band in the second colour, a shirt's own.
  const cuff = o.kind === 'jacket' ? o.shirt : o.kind === 'zip' ? c.trim : shade(c.shirt, 0.94);
  loft(out, { ...s.sleeveToWrist, around: 12, colour: (i) => (i >= WRIST_CUFF ? cuff : c.shirt), vary: 0.04, start: 0.01 }, m);
  if (o.kind === 'zip') band(out, s.sleeveToWrist, -0.13, 0.13, () => -0.238, () => 0.03, c.trim, 2, 5, 0.003, m);
}

function buildHand(out: Facets, s: Shapes, c: PlayerColours, wrist: Matrix4): void {
  const m = wrist.clone().multiply(new Matrix4().makeScale(s.hand, s.hand, s.hand));
  loft(out, { ...PALM, around: 8, colour: c.skin, vary: 0.04, end: 0.006 }, m);
  const turn = new Matrix4();
  for (const [y, length, r, fan] of FINGERS) {
    // Fanned out a little, and curled a touch towards the palm.
    turn.makeRotationY(0.06).premultiply(new Matrix4().makeRotationX(fan)).setPosition(0, y, -0.088);
    loft(out, finger(length, r, c.skin), m.clone().multiply(turn));
  }
  const thumb = new Matrix4().makeRotationFromQuaternion(
    new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(-0.34, 0.4, -0.85).normalize()),
  ).setPosition(-0.007, 0.03, -0.028);
  loft(out, {
    rings: [R(0.012, 0.0135, 0.015, 0.015), R(-0.024, 0.0115, 0.0125, 0.0125), R(-0.042, 0.0095, 0.01, 0.01), R(-0.052, 0.008, 0.0085, 0.0085)],
    around: 6, colour: c.skin, vary: 0.04, end: 0.005,
  }, m.clone().multiply(thumb));
}

// ---- The neck and head ----------------------------------------------------------------

const NECK: Surface = {
  rings: [
    R(-0.075, 0.068, 0.058, 0.062),
    R(0, 0.061, 0.054, 0.058),
    R(0.05, 0.057, 0.05, 0.055),
    R(0.1, 0.054, 0.046, 0.05, -0.004),
    R(0.14, 0.05, 0.04, 0.046, -0.01),
  ],
  // The Adam's apple.
  shape: (p, a, z) => {
    if (Math.sin(a) > 0.8) p.y += 0.004 * bump(z, 0.04, 0.1);
  },
};

/** The head's middle, above the top of the neck. */
const HEAD_AT = new Vector3(0, 0.012, BONES.head);

/** The head about its middle, chin to crown. */
const HEAD: Surface = {
  rings: [
    R(-0.118, 0.026, 0.062, 0.02, 0.022, 2.3),
    R(-0.105, 0.046, 0.078, 0.04, 0.01, 2.4),
    R(-0.088, 0.06, 0.083, 0.058, 0.002, 2.5),
    R(-0.065, 0.068, 0.09, 0.075, 0, 2.5),
    R(-0.04, 0.074, 0.094, 0.088, 0, 2.5),
    R(-0.012, 0.077, 0.093, 0.095, 0, 2.5),
    R(0.012, 0.079, 0.098, 0.099, 0, 2.5),
    R(0.035, 0.08, 0.093, 0.1, -0.004, 2.4),
    R(0.07, 0.077, 0.086, 0.097, -0.006, 2.3),
    R(0.098, 0.066, 0.072, 0.085, -0.008, 2.2),
    R(0.118, 0.04, 0.045, 0.055, -0.01, 2.1),
  ],
  shape: (p, a, z) => {
    const off = fromFront(a);
    // Cheekbones, the brow ridge, the angle of the jaw, the point of the chin.
    pushOut(p, a, 0.006 * bump(off, 0.45, 1.35) * bump(z, -0.06, -0.012));
    if (off < 0.7) p.y += 0.004 * bump(z, -0.002, 0.026) * bump(off, -0.7, 0.7);
    pushOut(p, a, 0.004 * bump(off, 1.3, 2.2) * bump(z, -0.11, -0.06));
    if (off < 0.5) p.y += 0.004 * bump(z, -0.125, -0.095);
  },
};

/** A point on the face `x` across and `z` up from the head's middle, lifted `lift` off it. */
function face(head: Surface, x: number, z: number, lift = 0): Vector3 {
  return onSurface(head, angleAcross(head, x, z, true), z, lift)[0];
}

/** Where the hair stops, by how far round from the front: the forehead, the temples, the sideburns, over the ears, the nape. */
const HAIRLINE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.05], [0.35, 0.047], [0.7, 0.034], [1.05, 0.02], [1.2, -0.022], [1.36, -0.024], [1.48, 0.03], [1.78, 0.036],
  [2.1, -0.02], [2.6, -0.068], [Math.PI, -0.076],
];

/** A woman's: up off the forehead, no sideburns, round over the ears, down to the nape. */
const HAIRLINE_W: ReadonlyArray<readonly [number, number]> = [
  [0, 0.054], [0.5, 0.047], [0.9, 0.032], [1.2, 0.006], [1.4, 0.01], [1.55, 0.034], [1.85, 0.034], [2.1, -0.03],
  [2.6, -0.078], [Math.PI, -0.086],
];

function hairline(off: number, line = HAIRLINE): number {
  for (let i = 0; i + 1 < line.length; i++) {
    const [a0, z0] = line[i];
    const [a1, z1] = line[i + 1];
    if (off <= a1) return z0 + ((z1 - z0) * (off - a0)) / (a1 - a0);
  }
  return line[line.length - 1][1];
}

/** Men's hair, as the game's looks have it: 0 cropped close all over, 1 short at the sides and fuller on top, 2 shaved. */
export type HairStyle = 0 | 1 | 2;

/**
 * A cut: how thick the hair is at the sides and how much more on top, how far it is swept up over
 * the forehead, how big the locks standing out of it are (none: smooth), and how far the sides
 * fade towards the skin.
 */
interface Cut {
  sides: number;
  top: number;
  quiff: number;
  locks: number;
  fade: number;
}

const CUTS: Readonly<Record<HairStyle, Cut>> = {
  0: { sides: 0.0035, top: 0.005, quiff: 0.005, locks: 0.55, fade: 0.25 },
  1: { sides: 0.0035, top: 0.007, quiff: 0.014, locks: 1, fade: 0.4 },
  2: { sides: 0.0022, top: 0.0024, quiff: 0, locks: 0, fade: 0 },
};

function hairDepth(cut: Cut, off: number, t: number): number {
  return cut.sides + cut.top * t + cut.quiff * Math.max(0, Math.cos(off)) ** 1.5 * bump(t, 0.05, 1.1);
}

/** Out from the head through a point on it — near enough square to the hair there. */
function hairOut(p: Vector3): Vector3 {
  return p.clone().sub(new Vector3(0, -0.005, 0)).normalize();
}

/**
 * One lock standing out of the hair: a three-sided spike rooted in it, leaning the way the hair
 * is swept — up and forward in the quiff, back over the top.
 */
function lock(out: Facets, root: Vector3, o: Vector3, sweep: Vector3, size: number, height: number, colour: string, m: Matrix4): void {
  const along = sweep.clone().addScaledVector(o, -sweep.dot(o)).normalize();
  const across = new Vector3().crossVectors(o, along);
  const sunk = root.clone().addScaledVector(o, -0.003);
  const c0 = sunk.clone().addScaledVector(across, size * 0.6);
  const c1 = sunk.clone().addScaledVector(across, -size * 0.6);
  const c2 = sunk.clone().addScaledVector(along, -size);
  const tip = root.clone().addScaledVector(o, height).addScaledVector(along, height * 1.1);
  for (const [p, q] of [[c0, c1], [c1, c2], [c2, c0]] as const) {
    const face = p.clone().add(q).add(tip).divideScalar(3).sub(root);
    out.tri(p.clone().applyMatrix4(m), q.clone().applyMatrix4(m), tip.clone().applyMatrix4(m), colour, 0.1, face.transformDirection(m));
  }
}

const UP_AND_FORWARD = new Vector3(0, 0.45, 1).normalize();
const SWEPT_BACK = new Vector3(0, -1, 0.3).normalize();

function buildHair(out: Facets, head: Surface, c: PlayerColours, style: HairStyle, m: Matrix4): void {
  const cut = CUTS[style];
  // A shaved head shows the scalp through it: its stubble is half skin.
  const hair = style === 2 ? mix(c.skin, c.hair, 0.55) : c.hair;
  const around = 28;
  const top = head.rings[head.rings.length - 1].z;
  const at = (a: number, t: number, line: number): Vector3 => surfacePoint(head, a, line + (top - line) * t);
  const rows: Vector3[][] = [];
  // From the skin at the hairline (the edge's thickness), out to the hair, up to the crown.
  const steps: ReadonlyArray<readonly [number, number]> = [[0, -0.001], [0, 0.5], [0.18, 1], [0.38, 1], [0.58, 1], [0.76, 1], [0.92, 1]];
  steps.forEach(([t, depth], i) => {
    const row: Vector3[] = [];
    for (let j = 0; j < around; j++) {
      const a = (j / around) * TAU;
      const off = fromFront(a);
      // Over the forehead the hairline is ragged, a lock lower here and there.
      const line = hairline(off) - (off < 1 && style !== 2 ? hash(j * 131 + 7) * 0.012 : 0);
      const p = at(a, t, line);
      // Chunky: each point of the hair a little in or out, more so on top.
      const jitter = i > 1 ? (hash(j * 31 + i * 977) - 0.5) * (0.002 + 0.006 * t) * (style === 2 ? 0.2 : 1) : 0;
      row.push(p.addScaledVector(hairOut(p), depth < 0 ? depth : hairDepth(cut, off, t) * depth + jitter).applyMatrix4(m));
    }
    rows.push(row);
  });
  // The edge darker; the sides and back fading towards the skin; the top catching the light.
  const colourOfBand = (band: number, off: number): string => {
    if (band === 0) return shade(hair, 0.7);
    if (off > 0.95 && band <= 2) return mix(hair, c.skin, cut.fade * (band === 1 ? 1 : 0.45));
    return band >= 4 ? shade(hair, 1.12) : hair;
  };
  const crown = new Vector3(0, -0.012, top + 0.009 + hairDepth(cut, 0.6, 1)).applyMatrix4(m);
  const tri = (p: Vector3, q: Vector3, r: Vector3, colour: string): void => out.tri(p, q, r, colour, 0.09);
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j < around; j++) {
      const k = (j + 1) % around;
      const colour = colourOfBand(i, fromFront(((j + 0.5) / around) * TAU));
      if ((i + j) % 2 === 0) {
        tri(rows[i][j], rows[i][k], rows[i + 1][k], colour);
        tri(rows[i][j], rows[i + 1][k], rows[i + 1][j], colour);
      } else {
        tri(rows[i][j], rows[i][k], rows[i + 1][j], colour);
        tri(rows[i][k], rows[i + 1][k], rows[i + 1][j], colour);
      }
    }
  }
  const row = rows[rows.length - 1];
  for (let j = 0; j < around; j++) tri(row[j], row[(j + 1) % around], crown, shade(hair, 1.12));

  if (cut.locks === 0) return;
  const grow = (a: number, t: number, size: number, height: number, sweep: Vector3, n: number): void => {
    const off = fromFront(a);
    const p = at(a, t, hairline(off));
    const o = hairOut(p);
    p.addScaledVector(o, hairDepth(cut, off, t));
    const k = 0.75 + hash(n * 17 + 3) * 0.5;
    lock(out, p, o, sweep, size * k, height * k * cut.locks, shade(hair, 0.92 + hash(n * 29 + 5) * 0.24), m);
  };
  // The quiff: locks over the forehead standing up and forward.
  [-0.5, -0.25, 0, 0.25, 0.5].forEach((d, n) => grow(Math.PI / 2 + d + (hash(n + 40) - 0.5) * 0.12, 0.16 + hash(n + 50) * 0.12, 0.02, 0.013, UP_AND_FORWARD, n));
  // Over the top and down the back of the crown: locks swept back.
  let n = 10;
  for (const [t, count] of [[0.42, 13], [0.66, 10], [0.86, 6]] as const) {
    for (let k = 0; k < count; k++) {
      const a = ((k + 0.5 * (n % 2)) / count) * TAU + (hash(n * 7) - 0.5) * 0.2;
      n++;
      if (fromFront(a) > 2.5 && t < 0.6) continue;
      grow(a, t, 0.018, 0.0075, SWEPT_BACK, n);
    }
  }
}

/**
 * A woman's hair, as the game has it: 0 drawn back into a ponytail, 1 into a bun, 2 a bob to the
 * jaw — a fringe across the forehead, framing the face, falling straight from the widest of the
 * head rather than following the jaw in.
 */
function buildWomensHair(out: Facets, head: Surface, c: PlayerColours, style: HairStyle, m: Matrix4): void {
  const bob = style === 2;
  const hair = c.hair;
  const around = 28;
  const top = head.rings[head.rings.length - 1].z;
  const edge = (off: number, j: number): number => {
    if (!bob) return hairline(off, HAIRLINE_W);
    const ragged = (hash(j * 53 + 11) - 0.5) * 0.008;
    if (off < 0.85) return 0.03 + ragged;
    if (off < 1.25) return 0.03 - ((off - 0.85) / 0.4) * 0.115 + ragged;
    return -0.085 + ragged;
  };
  // Drawn back, it lies close and sleek, a little fuller over the forehead; a bob stands off the head, fuller at the crown.
  const depth = (t: number): number => (bob ? 0.012 + 0.006 * t : 0.006 + 0.005 * t);
  const at = (a: number, z: number): Vector3 => {
    const p = surfacePoint(head, a, bob ? Math.max(z, -0.015) : z);
    p.z = z;
    return p;
  };
  const steps: ReadonlyArray<readonly [number, number]> = [[0, -1], [0, 0.6], [0.15, 1], [0.35, 1], [0.55, 1], [0.75, 1], [0.92, 1]];
  const rows = steps.map(([t, k], i) => {
    const row: Vector3[] = [];
    for (let j = 0; j < around; j++) {
      const a = (j / around) * TAU;
      const line = edge(fromFront(a), j);
      const p = at(a, line + (top - line) * t);
      const jitter = i > 1 ? (hash(j * 37 + i * 911) - 0.5) * (bob ? 0.005 : 0.0015) : 0;
      row.push(p.addScaledVector(hairOut(p), k < 0 ? -0.002 : depth(t) * k + jitter).applyMatrix4(m));
    }
    return row;
  });
  const crown = new Vector3(0, -0.012, top + 0.009 + depth(1)).applyMatrix4(m);
  const tri = (p: Vector3, q: Vector3, r: Vector3, colour: string): void => out.tri(p, q, r, colour, 0.08);
  for (let i = 0; i + 1 < rows.length; i++) {
    const colour = i === 0 ? shade(hair, 0.7) : i >= 4 ? shade(hair, 1.1) : hair;
    for (let j = 0; j < around; j++) {
      const k = (j + 1) % around;
      if ((i + j) % 2 === 0) {
        tri(rows[i][j], rows[i][k], rows[i + 1][k], colour);
        tri(rows[i][j], rows[i + 1][k], rows[i + 1][j], colour);
      } else {
        tri(rows[i][j], rows[i][k], rows[i + 1][j], colour);
        tri(rows[i][k], rows[i + 1][k], rows[i + 1][j], colour);
      }
    }
  }
  const row = rows[rows.length - 1];
  for (let j = 0; j < around; j++) tri(row[j], row[(j + 1) % around], crown, shade(hair, 1.1));
  // The parting, a little to her right, from the hairline (behind a bob's fringe) back over the top.
  const part = Math.PI / 2 - 0.32;
  const parting: Array<[Vector3, Vector3, Vector3]> = [];
  for (let k = 0; k <= 6; k++) {
    const t = (bob ? 0.14 : 0.02) + (k / 6) * 0.78;
    const side = (a: number): Vector3 => {
      const line = edge(fromFront(a), 0);
      const p = at(a, line + (top - line) * t);
      return p.addScaledVector(hairOut(p), depth(t) + 0.0012);
    };
    const mid = side(part);
    parting.push([side(part - 0.018).applyMatrix4(m), side(part + 0.018).applyMatrix4(m), hairOut(mid).transformDirection(m)]);
  }
  for (let k = 0; k + 1 < parting.length; k++) {
    const [a0, a1, o] = parting[k];
    const [b0, b1] = parting[k + 1];
    out.tri(a0, a1, b1, shade(hair, 0.62), 0.04, o);
    out.tri(a0, b1, b0, shade(hair, 0.62), 0.04, o);
  }
  // Locks falling down the bob's sides and back.
  let n = 300;
  for (const [t, count] of (bob ? [[0.22, 14], [0.5, 12]] : []) as ReadonlyArray<readonly [number, number]>) {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU + (hash(n * 7) - 0.5) * 0.25;
      n++;
      const off = fromFront(a);
      if (off < 0.9) continue;
      const line = edge(off, k);
      const p = at(a, line + (top - line) * t);
      const o = hairOut(p);
      p.addScaledVector(o, depth(t));
      lock(out, p, o, new Vector3(0, 0, -1), 0.016, 0.007, shade(hair, 0.92 + hash(n * 29) * 0.22), m);
    }
  }
  if (style === 0) {
    // The tie at the back of the crown, and the tail falling from it down between the shoulder blades.
    loft(out, {
      rings: [
        R(0.05, 0.016, 0.016, 0.016, -0.1), R(0.04, 0.02, 0.02, 0.02, -0.112), R(0.03, 0.026, 0.026, 0.026, -0.118),
        R(-0.04, 0.03, 0.028, 0.03, -0.128), R(-0.11, 0.026, 0.024, 0.026, -0.124), R(-0.18, 0.018, 0.017, 0.018, -0.112),
      ],
      around: 8, vary: 0.08, end: 0.04, colour: (i) => (i === 0 ? '#1d1a1a' : i >= 3 ? shade(hair, 1.08) : hair),
    }, m);
  } else if (style === 1) {
    // The bun, high at the back.
    blob(out, 0, -0.11, 0.072, 0.036, 0.03, 0.032, shade(hair, 1.05), 10, 5, m);
  }
}

/** One ear, on the right: its outline seen from the side (forward, up) about its middle. */
const EAR: ReadonlyArray<readonly [number, number]> = [
  [0.011, 0.026], [-0.004, 0.033], [-0.017, 0.026], [-0.023, 0.008], [-0.019, -0.012], [-0.011, -0.027],
  [0.0, -0.033], [0.008, -0.028], [0.01, -0.01], [0.012, 0.01],
];
const EAR_AT = { y: -0.01, z: -0.014 };

function buildEar(out: Facets, head: Surface, c: PlayerColours, m: Matrix4): void {
  const base = surfacePoint(head, 0, EAR_AT.z).x - 0.004;
  // Standing off the head more at the back than where it joins at the front.
  const outer = (y: number): number => base + 0.008 + (0.012 - y) * 0.42;
  const pts = EAR.map(([y, z]) => new Vector2(y, z));
  const at = (y: number, z: number, x: number): Vector3 => new Vector3(x, EAR_AT.y + y, EAR_AT.z + z).applyMatrix4(m);
  const away = new Vector3(1, -0.25, 0).transformDirection(m);
  for (const [i, j, k] of ShapeUtils.triangulateShape(pts, [])) {
    const [p, q, r] = [pts[i], pts[j], pts[k]];
    out.tri(at(p.x, p.y, outer(p.x)), at(q.x, q.y, outer(q.x)), at(r.x, r.y, outer(r.x)), c.skin, 0.05, away);
  }
  // Its rim, round the back and over the top.
  const mid = new Vector2();
  pts.forEach((p) => mid.add(p));
  mid.divideScalar(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const o = new Vector3(0, (p.x + q.x) / 2 - mid.x, (p.y + q.y) / 2 - mid.y).transformDirection(m);
    const p0 = at(p.x, p.y, base - 0.004);
    const p1 = at(p.x, p.y, outer(p.x));
    const q0 = at(q.x, q.y, base - 0.004);
    const q1 = at(q.x, q.y, outer(q.x));
    out.tri(p0, q0, q1, c.skin, 0.05, o);
    out.tri(p0, q1, p1, c.skin, 0.05, o);
  }
  // The hollow inside it, in shadow.
  const hollow = [[0.004, 0.016], [-0.01, 0.02], [-0.014, 0.004], [-0.008, -0.016], [0.002, -0.012], [0.004, 0.0]] as const;
  const inner: Placer = (y, z) => [at(y, z, outer(y) + 0.0008), away.clone()];
  print(out, hollow, inner, shade(c.skin, 0.8), IDENTITY, 0);
}

function buildNose(out: Facets, head: Surface, c: PlayerColours, m: Matrix4): void {
  const B = face(head, 0, 0.004, 0.003);
  const SR = face(head, 0.009, -0.006);
  const SL = face(head, -0.009, -0.006);
  const T = face(head, 0, -0.036).add(new Vector3(0, 0.024, 0));
  const U = face(head, 0, -0.047, 0.004);
  const Rw = face(head, 0.016, -0.042, 0.005);
  const Lw = face(head, -0.016, -0.042, 0.005);
  const Rb = face(head, 0.019, -0.047);
  const Lb = face(head, -0.019, -0.047);
  const under = shade(c.skin, 0.82);
  const faces: Array<[Vector3, Vector3, Vector3, string]> = [
    [B, SR, T, c.skin], [B, T, SL, c.skin], [SR, Rw, T, c.skin], [SL, T, Lw, c.skin],
    [T, Rw, U, under], [T, U, Lw, under], [SR, Rb, Rw, c.skin], [Rw, Rb, U, under], [SL, Lw, Lb, c.skin], [Lw, U, Lb, under],
  ];
  for (const [p, q, r, colour] of faces) {
    const o = p.clone().add(q).add(r).divideScalar(3);
    out.tri(p.clone().applyMatrix4(m), q.clone().applyMatrix4(m), r.clone().applyMatrix4(m), colour, 0.05, o.transformDirection(m));
  }
}

/** A beard: none, stubble, or a full one. */
export type Beard = 0 | 1 | 2;

function buildHead(out: Facets, ink: Facets, s: Shapes, c: PlayerColours, hair: HairStyle, beard: Beard, glasses: boolean): void {
  const woman = s.frame === 'woman';
  const m = new Matrix4().makeTranslation(HEAD_AT.x, HEAD_AT.y, HEAD_AT.z).multiply(new Matrix4().makeScale(s.headSize, s.headSize, s.headSize));
  // Stubble a shadow of the hair's colour on the skin; a full beard nearly the hair's own. Under the
  // chin and along the jaw, round the mouth and up the sideburns; the moustache under the nose.
  const growth = beard === 0 ? null : mix(c.skin, c.hair, beard === 1 ? 0.32 : 0.8);
  // Under it, the skin itself has some depth: in shadow under the jaw and in the eye sockets, warmer
  // over the cheeks, the light catching the bridge of the nose. Its bands run up the head's rings:
  // 0-2 the chin and jaw, 3 the mouth, 4 the cheekbones, 5 the eyes.
  const cheeks = mix(c.skin, '#d06a5c', woman ? 0.12 : 0.07);
  const skin = (bandIndex: number, a: number): string => {
    const off = fromFront(a);
    if (growth !== null && bandIndex <= 2 && off < 1.9) return growth;
    if (growth !== null && bandIndex === 3 && (off < 0.32 || (off > 1.15 && off < 1.75))) return growth;
    if (bandIndex <= 0) return shade(c.skin, 0.88);
    if (bandIndex === 5 && off > 0.3 && off < 0.85) return shade(c.skin, 0.92);
    if ((bandIndex === 5 || bandIndex === 6) && off < 0.2) return shade(c.skin, 1.04);
    if ((bandIndex === 3 || bandIndex === 4) && off > 0.4 && off < 1.15) return cheeks;
    return c.skin;
  };
  loft(out, { ...s.head, around: 20, colour: skin, vary: 0.04, start: 0.006, end: 0.009 }, m);
  if (woman) buildWomensHair(out, s.head, c, hair, m);
  else buildHair(out, s.head, c, hair, m);
  buildNose(out, s.head, c, m);
  // A bob hides the ears.
  if (!(woman && hair === 2)) {
    buildEar(out, s.head, c, m);
    buildEar(out, s.head, c, m.clone().multiply(new Matrix4().makeScale(-1, 1, 1)));
  }
  const at = (lift: number): Placer => (u, v) => onSurface(s.head, angleAcross(s.head, u, v, true), v, lift);
  // Each eye: its white under the lid, the iris, the lash line over it, a glint; the brow above.
  for (const side of [1, -1]) {
    const x0 = side * 0.031;
    const z0 = -0.004;
    // A woman's eyes a touch bigger.
    const big = woman ? 1.08 : 1;
    const local = (pts: ReadonlyArray<readonly [number, number]>): Array<[number, number]> =>
      pts.map(([dx, dz]) => [x0 + side * dx * big, z0 + dz * big]);
    print(out, local([[-0.013, 0], [-0.007, 0.005], [0.003, 0.0058], [0.012, 0.002], [0.013, -0.0005], [0.006, -0.0045], [-0.004, -0.0045]]), at(0.003), c.eyes, m, 1, 0.02);
    const iris: Array<[number, number]> = [];
    for (let k = 0; k < 6; k++) iris.push([Math.cos((k / 6) * TAU) * 0.0046, 0.0004 + Math.sin((k / 6) * TAU) * 0.0046]);
    print(ink, local(iris), at(0.0042), c.iris, m, 0, 0.02);
    // A woman's lash line heavier, flicked up at the outer corner; her brows finer and arched.
    const lashes: ReadonlyArray<readonly [number, number]> = woman
      ? [[-0.0145, 0.0004], [-0.007, 0.0066], [0.003, 0.0074], [0.0145, 0.0034], [0.0178, 0.0054], [0.0135, 0.0012], [0.003, 0.0052], [-0.007, 0.0046], [-0.012, -0.0004]]
      : [[-0.014, 0.0004], [-0.007, 0.0062], [0.003, 0.0069], [0.0135, 0.0025], [0.0125, 0.0011], [0.003, 0.0052], [-0.007, 0.0046], [-0.012, -0.0004]];
    const brows: ReadonlyArray<readonly [number, number]> = woman
      ? [[-0.014, 0.012], [-0.004, 0.0175], [0.01, 0.0172], [0.017, 0.0125], [0.009, 0.0148], [-0.004, 0.0152], [-0.012, 0.0102]]
      : [[-0.015, 0.0115], [-0.004, 0.0168], [0.012, 0.015], [0.017, 0.011], [0.004, 0.0122], [-0.012, 0.0092]];
    print(ink, local(lashes), at(0.0047), c.ink, m, 0, 0.02);
    print(ink, local(rect(0.0012, 0.0016, 0.0027, 0.0031)), at(0.0052), '#ffffff', m, 0, 0);
    print(out, local(brows), at(0.0036), c.brows, m, 1, 0.04);
    // The crease of the upper lid, a shadow over the eye.
    const crease: ReadonlyArray<readonly [number, number]> = [
      [-0.012, 0.0072], [-0.004, 0.0098], [0.006, 0.0097], [0.0135, 0.0058], [0.013, 0.0047], [0.006, 0.0084], [-0.004, 0.0085], [-0.011, 0.0061],
    ];
    print(out, local(crease), at(0.0032), shade(c.skin, 0.8), m, 1, 0.02);
  }
  // The lips — a woman's fuller — and the line between them.
  const lip = woman ? 1.3 : 1;
  const mouth = (pts: ReadonlyArray<readonly [number, number]>): Array<[number, number]> =>
    pts.map(([x, z]) => [x * (woman ? 0.95 : 1), -0.0675 + (z + 0.0675) * lip]);
  print(out, mouth([[-0.019, -0.067], [-0.008, -0.0632], [0, -0.0643], [0.008, -0.0632], [0.019, -0.067], [0.008, -0.0676], [-0.008, -0.0676]]), at(0.003), c.lips, m, 1);
  print(out, mouth([[-0.016, -0.0685], [0.016, -0.0685], [0.01, -0.0748], [-0.01, -0.0748]]), at(0.003), shade(c.lips, 1.12), m, 1);
  print(ink, [[-0.0195, -0.0668], [0.0195, -0.0668], [0.0185, -0.0682], [-0.0185, -0.0682]], at(0.0038), shade(c.lips, 0.5), m, 0, 0);
  if (glasses) {
    // Thin dark rims standing off the face, the bridge over the nose, the arms back to the ears.
    const frame = '#1b1d22';
    for (const side of [1, -1]) {
      const x0 = side * 0.031;
      const [l, r] = [x0 - 0.021, x0 + 0.021];
      for (const [u0, v0, u1, v1] of [[l, 0.0085, r, 0.0115], [l, -0.0165, r, -0.0135], [l, -0.0165, l + 0.003, 0.0115], [r - 0.003, -0.0165, r, 0.0115]]) {
        print(out, rect(u0, v0, u1, v1), at(0.008), frame, m, 1, 0);
      }
      const rim = angleAcross(s.head, side * 0.052, 0.002, true);
      const ear = side > 0 ? -0.12 : Math.PI + 0.12;
      band(out, s.head, Math.min(rim, ear), Math.max(rim, ear), () => 0.0005, () => 0.0035, frame, 6, 1, 0.005, m);
    }
    print(out, rect(-0.01, 0.003, 0.01, 0.0058), at(0.0095), frame, m, 1, 0);
  }
}

// ---- A man's build, and a woman's ------------------------------------------------------

/** A man's build or a woman's. */
export type Frame = 'man' | 'woman';

/** The same rings, each changed by `f` — the same muscles on them. */
function reshape(s: Surface, f: (r: Ring) => Partial<Ring>): Surface {
  return { ...s, rings: s.rings.map((r) => ({ ...r, ...f(r) })) };
}

/** Thinner (under 1) or thicker all round. */
function slim(s: Surface, k: number): Surface {
  return reshape(s, (r) => ({ w: r.w * k, f: r.f * k, b: r.b * k }));
}

/** Every surface a body is made of, and how much smaller its hands, feet and head are. */
interface Shapes {
  frame: Frame;
  shirt: Surface;
  collar: Surface;
  shorts: Surface;
  shortsLeg: Surface;
  thigh: Surface;
  pad: Surface;
  shin: Surface;
  trouserThigh: Surface;
  trouserShin: Surface;
  sleeve: Surface;
  upperArm: Surface;
  forearm: Surface;
  sleeveToElbow: Surface;
  sleeveToWrist: Surface;
  neck: Surface;
  head: Surface;
  /** The shoulder's cap, the hand, the foot (across, along) and the head, against a man's. */
  shoulder: number;
  hand: number;
  foot: [number, number];
  headSize: number;
}

const MAN: Shapes = {
  frame: 'man', shirt: SHIRT, collar: COLLAR, shorts: SHORTS, shortsLeg: SHORTS_LEG, thigh: THIGH, pad: PAD, shin: SHIN,
  trouserThigh: TROUSER_THIGH, trouserShin: TROUSER_SHIN, sleeve: SLEEVE, upperArm: UPPER_ARM, forearm: FOREARM,
  sleeveToElbow: SLEEVE_TO_ELBOW, sleeveToWrist: SLEEVE_TO_WRIST, neck: NECK, head: HEAD,
  shoulder: 1, hand: 1, foot: [1, 1], headSize: 1,
};

/**
 * A woman's: as figure3d.ts has it — a little slimmer through the limbs and the shoulders, narrower
 * at the waist, wider at the hips, with a bust; a softer jaw and a slightly smaller head. Her shorts
 * are a woman's volleyball shorts: short and close, the thigh bare below them.
 */
const WOMAN: Shapes = {
  frame: 'woman',
  shirt: {
    ...reshape(SHIRT, (r) => {
      const k = r.z <= -0.06 ? 1.05 : r.z < 0.25 ? 0.88 : 0.9;
      return { w: r.w * k, f: r.f * (r.z > -0.06 && r.z < 0.25 ? 0.92 : 1), b: r.b * 0.95 };
    }),
    // The bust, and the shoulder blades.
    shape: (p, a, z) => {
      const x = Math.abs(p.x);
      if (Math.sin(a) > 0) p.y += 0.028 * bump(z, 0.26, 0.45) * bump(x, -0.01, 0.14);
      else p.y -= 0.006 * bump(z, 0.28, 0.5) * bump(x, 0.02, 0.15);
    },
  },
  collar: slim(COLLAR, 0.88),
  // Cut high between the legs, so the legs' hems hang below it.
  shorts: {
    rings: [R(-0.092, 0.1, 0.07, 0.078, 0, 2.4), R(-0.07, 0.178, 0.098, 0.118, 0, 2.4), R(-0.03, 0.193, 0.104, 0.132, 0, 2.4), R(0.02, 0.182, 0.101, 0.128, 0, 2.4), R(0.1, 0.143, 0.095, 0.098, 0, 2.4)],
    shape: (p, a, z) => {
      if (Math.sin(a) < 0) p.y -= 0.016 * bump(z, -0.12, 0.05) * bump(Math.abs(p.x), 0.01, 0.17);
    },
  },
  shortsLeg: { rings: [R(0, 0.088, 0.09, 0.097), R(-0.05, 0.095, 0.097, 0.103), R(-0.108, 0.09, 0.092, 0.096), R(-0.108, 0.083, 0.087, 0.085)] },
  thigh: {
    ...THIGH,
    rings: [
      R(-0.06, 0.085, 0.088, 0.088),
      R(-0.16, 0.078, 0.082, 0.079),
      R(-0.25, 0.07, 0.075, 0.069),
      R(-0.34, 0.064, 0.072, 0.062),
      R(-0.4, 0.058, 0.065, 0.054),
      R(-0.44, 0.052, 0.057, 0.049),
      R(-0.48, 0.048, 0.051, 0.046),
    ],
  },
  pad: slim(PAD, 0.93),
  shin: slim(SHIN, 0.9),
  trouserThigh: slim(TROUSER_THIGH, 0.95),
  trouserShin: slim(TROUSER_SHIN, 0.93),
  sleeve: slim(SLEEVE, 0.92),
  upperArm: slim(UPPER_ARM, 0.88),
  forearm: slim(FOREARM, 0.88),
  sleeveToElbow: slim(SLEEVE_TO_ELBOW, 0.9),
  sleeveToWrist: slim(SLEEVE_TO_WRIST, 0.9),
  // No Adam's apple.
  neck: { rings: slim(NECK, 0.86).rings },
  head: {
    ...reshape(HEAD, (r) => (r.z < -0.08 ? { w: r.w * 0.88, b: r.b * 0.93 } : r.z < -0.03 ? { w: r.w * 0.93, b: r.b * 0.95 } : {})),
    shape: (p, a, z) => {
      const off = fromFront(a);
      // Cheekbones and the point of the chin, softer; no ridge over the brow, no angle at the jaw.
      pushOut(p, a, 0.004 * bump(off, 0.45, 1.35) * bump(z, -0.06, -0.012));
      if (off < 0.5) p.y += 0.003 * bump(z, -0.125, -0.095);
    },
  },
  shoulder: 0.9, hand: 0.9, foot: [0.9, 0.92], headSize: 0.96,
};

// ---- The body ------------------------------------------------------------------------

/** What a body is drawn with: one lit material for all of it — each face's colour is its own — and one unlit, for the ink on the face. */
export interface BodyMaterials {
  body: MeshStandardMaterial;
  ink: MeshBasicMaterial;
}

export function bodyMaterials(): BodyMaterials {
  return {
    body: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0 }),
    ink: new MeshBasicMaterial({ vertexColors: true }),
  };
}

let shared: BodyMaterials | null = null;

/** What else one player differs from another by. */
export interface PlayerBuild {
  /** On the shirt, front and back; 0 for none. Absent: 4. */
  number?: number;
  /** Absent: a man's. */
  frame?: Frame;
  /** A man's absent: short, fuller on top; a woman's a ponytail. */
  hair?: HairStyle;
  /** Never a woman's. */
  beard?: Beard;
  glasses?: boolean;
  /** A coach's clothes instead of the kit — and then no number. */
  outfit?: Outfit;
  /** Every player shares one pair unless given his own — to be faded out on his own, say. */
  materials?: BodyMaterials;
  /** Whether the body is shaded by its own shadow, or only casts one. Absent: shaded. */
  selfShadow?: boolean;
}

/** The collarbones' pivot above the small of the back: the shoulders shrug from here. */
const CLAVICLE = 0.47;

function joint(name: string, parent: Group, x: number, y: number, z: number): Group {
  const g = new Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function dress(g: Group, facets: Facets, material: Material, cast: boolean, receive: boolean): void {
  if (facets.empty) return;
  const mesh = new Mesh(facets.geometry(), material);
  mesh.name = `${g.name}Mesh`;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  g.add(mesh);
}

/** Build the player, standing in the T-pose. */
export function buildVolleyballPlayer(colours: PlayerColours = KIT_FOUR, build: PlayerBuild = {}): VolleyballPlayer {
  const { body, ink } = build.materials ?? (shared ??= bodyMaterials());
  const receive = build.selfShadow ?? true;
  const root = new Group();
  root.name = 'VolleyballPlayer';
  const hips = joint('Hips', root, 0, 0, HIP_HEIGHT);
  const torso = joint('Torso', hips, 0, 0, BONES.spine);
  const neck = joint('Neck', torso, 0, 0, 0.55);
  const head = joint('Head', neck, 0, 0, BONES.neck - 0.55);
  let seed = 1;
  const facets = (): Facets => new Facets(seed++);

  const s = build.frame === 'woman' ? WOMAN : MAN;
  const outfit = build.outfit;
  const trousers = outfit !== undefined;
  const hipsF = facets();
  buildHips(hipsF, s, colours, trousers);
  dress(hips, hipsF, body, true, receive);
  const torsoF = facets();
  if (outfit === undefined) buildTorso(torsoF, s, colours, build.number ?? 4);
  else buildTop(torsoF, s, colours, outfit);
  dress(torso, torsoF, body, true, receive);
  const neckF = facets();
  loft(neckF, { ...s.neck, around: 12, colour: colours.skin, vary: 0.04, end: 0.01 });
  dress(neck, neckF, body, true, receive);
  const headF = facets();
  const inkF = facets();
  const woman = s.frame === 'woman';
  buildHead(headF, inkF, s, colours, build.hair ?? (woman ? 0 : 1), woman ? 0 : build.beard ?? 0, build.glasses === true);
  dress(head, headF, body, true, receive);
  dress(head, inkF, ink, false, false);

  const limbs = (side: 1 | -1): Limbs => {
    const tag = side > 0 ? 'R' : 'L';
    const mirror = new Matrix4().makeScale(side, 1, 1);
    const shoulder = joint(`Shoulder.${tag}`, torso, side * 0.05, 0, CLAVICLE);
    const upperArm = joint(`UpperArm.${tag}`, shoulder, side * (BONES.shoulderOut - 0.05), 0, BONES.shoulderUp - CLAVICLE);
    const forearm = joint(`Forearm.${tag}`, upperArm, 0, 0, -BONES.upperArm);
    const hand = joint(`Hand.${tag}`, forearm, 0, 0, -BONES.forearm);
    const thigh = joint(`Thigh.${tag}`, hips, side * BONES.hipOut, 0, 0);
    // As the rig turns a hip: out to the side first, then forward.
    thigh.rotation.order = 'YXZ';
    const shin = joint(`Shin.${tag}`, thigh, 0, 0, -BONES.thigh);
    const foot = joint(`Foot.${tag}`, shin, 0, 0, -BONES.shin);
    const parts: Array<[Group, (f: Facets) => void]> = [
      [shoulder, (f) => buildShoulder(f, s, colours, side)],
      [upperArm, (f) => buildUpperArm(f, s, colours, mirror, outfit)],
      [forearm, (f) => buildForearm(f, s, colours, mirror, outfit)],
      [hand, (f) => buildHand(f, s, colours, mirror)],
      [thigh, (f) => buildThigh(f, s, colours, mirror, side < 0, outfit)],
      [shin, (f) => buildShin(f, s, colours, mirror, outfit)],
      [foot, (f) => buildFoot(f, s, colours, mirror, !trousers)],
    ];
    for (const [g, make] of parts) {
      const f = facets();
      make(f);
      dress(g, f, body, true, receive);
    }
    return { shoulder, upperArm, forearm, hand, thigh, shin, foot };
  };

  const player: VolleyballPlayer = { root, joints: { hips, torso, neck, head, right: limbs(1), left: limbs(-1) } };
  tPose(player);
  return player;
}

/** Every joint back to the T-pose: straight up, arms out level with the palms down, the feet a little apart and flat. */
export function tPose(player: VolleyballPlayer): void {
  const j = player.joints;
  for (const g of [j.hips, j.torso, j.neck, j.head]) g.rotation.set(0, 0, 0);
  for (const [side, l] of [[1, j.right], [-1, j.left]] as const) {
    for (const g of Object.values(l)) g.rotation.set(0, 0, 0);
    l.shoulder.position.z = CLAVICLE;
    l.upperArm.rotation.y = -side * (Math.PI / 2);
    l.thigh.rotation.y = -side * LEG_SPREAD;
    l.foot.rotation.y = side * LEG_SPREAD;
  }
  // Legs turned out stand a little lower: the soles stay on the floor.
  j.hips.position.set(0, 0, BONES.ankle + (BONES.thigh + BONES.shin) * Math.cos(LEG_SPREAD));
}

// ---- On the court ----------------------------------------------------------------------

/** What the court asks of anyone on it — a Figure, or a CourtPlayer. */
export interface Person {
  readonly root: Group;
  /** Where the head is, for where someone is on screen. */
  readonly head: Group;
  pose(b: Pick<Body, 'x' | 'y' | 'lift' | 'yaw' | 'scale' | 'rig' | 'alpha'>): void;
  restyle(look: Look): void;
  handsAt(a: Vector3, b: Vector3): void;
  dispose(): void;
}

function lightness(hex: string): number {
  return new Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l;
}

/**
 * A look's colours on this body: the side's kit, the role's colour for the trim, the number where
 * it shows — or a coach's top, trousers and shoes, the dark soles and socks with them.
 */
export function coloursFor(look: Look): PlayerColours {
  const shirt = look.libero ? look.kit.libero : look.kit.shirt;
  // The number in the role's colour, where it shows on the shirt; else dark or white — as figure3d.ts prints it.
  const light = lightness(shirt) > 0.62;
  const number = Math.abs(lightness(look.trim) - lightness(shirt)) > 0.28 ? look.trim : light ? '#10151d' : '#ffffff';
  const coach = look.trousers === true;
  const shoe = look.shoes ?? (coach ? '#15181e' : look.kit.shirt);
  return {
    ...KIT_FOUR,
    shirt, shorts: look.kit.shorts, trim: look.trim, number, shoe,
    ...(coach ? { socks: '#1b1e24', sole: lightness(shoe) > 0.5 ? KIT_FOUR.sole : '#0d0f13', outsole: '#0d0f13' } : {}),
    skin: look.skin,
    lips: womanOf(look) ? mix(look.skin, '#a8394a', 0.42) : mix(look.skin, '#8a3b32', 0.3),
    hair: look.hair,
    brows: mix(look.hair, '#000000', 0.3),
    iris: look.eyes ?? '#4a2c18',
  };
}

/** A coach's clothes, from his look: trousers mean a coach's, a polo unless the front says otherwise. */
function outfitOf(look: Look): Outfit | undefined {
  if (look.trousers !== true) return undefined;
  return { kind: look.front?.kind ?? 'polo', longSleeves: look.longSleeves === true, shirt: look.front?.shirt ?? '#f4f6f8', tie: look.front?.tie ?? null };
}

/** A woman's frame whatever the game is, if the look says so; else the game's. */
function womanOf(look: Look): boolean {
  return look.women ?? womensGame();
}

/** Everything about a look this body shows: when any of it changes, the body is built again. */
function keyOf(look: Look): string {
  return [
    look.libero ? look.kit.libero : look.kit.shirt, look.kit.shorts, look.trim, look.number, look.skin, look.hair,
    look.hairStyle, look.eyes, look.shoes, look.beard, look.glasses, womanOf(look), JSON.stringify(outfitOf(look) ?? null),
  ].join('|');
}

function disposeShapes(g: Group): void {
  g.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose();
  });
}

/**
 * A player on the live court drawn as the low-poly athlete, and posed from the same skeleton as
 * every figure (playerRig.ts) — so he runs, jumps, digs and dives through a rally exactly as
 * figure3d.ts's bodies do.
 */
export class CourtPlayer implements Person {
  readonly root = new Group();
  /** The whole body tipped about the feet: a dive, a sprawl, flat out on the floor. */
  private readonly tip = new Group();
  /** His own, so he can fade out on his own. */
  private readonly materials = bodyMaterials();
  private model: VolleyballPlayer;
  private key: string;
  private alpha = 1;

  constructor(look: Look) {
    this.root.add(this.tip);
    this.key = keyOf(look);
    this.model = this.build(look);
  }

  get head(): Group {
    return this.model.joints.head;
  }

  /** His joints as they are now — they are new each time he is built again. */
  get joints(): PlayerJoints {
    return this.model.joints;
  }

  private build(look: Look): VolleyballPlayer {
    const model = buildVolleyballPlayer(coloursFor(look), {
      number: look.number,
      frame: womanOf(look) ? 'woman' : 'man',
      hair: Math.max(0, Math.min(2, Math.round(look.hairStyle))) as HairStyle,
      beard: look.beard ?? 0,
      glasses: look.glasses === true,
      outfit: outfitOf(look),
      materials: this.materials,
      selfShadow: false,
    });
    this.tip.add(model.root);
    return model;
  }

  /** A new kit, or a new face: the body is built again — its colours are in its shapes. */
  restyle(look: Look): void {
    const key = keyOf(look);
    if (key === this.key) return;
    this.key = key;
    this.tip.remove(this.model.root);
    disposeShapes(this.model.root);
    this.model = this.build(look);
  }

  /** Put the body where the motion has it, every joint at its angle — as Figure.pose does. */
  pose(b: Pick<Body, 'x' | 'y' | 'lift' | 'yaw' | 'scale' | 'rig' | 'alpha'>): void {
    const r = b.rig;
    const j = this.model.joints;
    this.root.position.set(b.x, b.y, b.lift);
    this.root.rotation.set(0, 0, b.yaw);
    this.root.scale.setScalar(b.scale);
    this.tip.position.z = r.root.rise;
    this.tip.rotation.set(r.root.pitch, r.root.roll, 0);
    j.hips.position.set(0, r.pelvis.y, r.pelvis.z);
    j.hips.rotation.set(r.pelvis.pitch, 0, 0);
    j.torso.rotation.set(r.spine.x, r.spine.y, r.spine.z);
    j.head.rotation.set(r.head.x, 0, r.head.z);
    // The rig's sides run left (0), right (1).
    [j.left, j.right].forEach((l, i) => {
      const arm = r.arms[i];
      l.shoulder.position.z = CLAVICLE + r.shoulderLift[i];
      l.upperArm.rotation.set(arm.x, arm.y, arm.z);
      l.forearm.rotation.set(arm.bend, 0, 0);
      l.hand.rotation.set(0, 0, 0);
      const leg = r.legs[i];
      l.thigh.rotation.set(leg.x, leg.y, 0);
      l.shin.rotation.set(-leg.bend, 0, 0);
      l.foot.rotation.set(leg.end, 0, 0);
    });
    if (Math.abs(b.alpha - this.alpha) > 0.01 || (b.alpha >= 0.99 && this.alpha < 1)) {
      this.alpha = b.alpha >= 0.99 ? 1 : b.alpha;
      for (const m of [this.materials.body, this.materials.ink]) {
        const see = this.alpha < 1;
        if (m.transparent !== see) {
          m.transparent = see;
          m.needsUpdate = true;
        }
        m.opacity = this.alpha;
      }
    }
  }

  /** Where the palms are, in court metres — for something held in them, a trophy over the head. */
  handsAt(a: Vector3, b: Vector3): void {
    this.root.updateMatrixWorld(true);
    const j = this.model.joints;
    for (const [v, l] of [[a, j.left], [b, j.right]] as const) {
      v.set(0, 0, -BONES.forearm - BONES.hand * 0.5);
      l.forearm.localToWorld(v);
    }
  }

  dispose(): void {
    disposeShapes(this.model.root);
    this.materials.body.dispose();
    this.materials.ink.dispose();
  }
}

/** The body for a player or a coach — a man or a woman, in the kit or a coach's clothes. */
export function personFor(look: Look): Person {
  return new CourtPlayer(look);
}
