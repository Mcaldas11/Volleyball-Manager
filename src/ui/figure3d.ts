/**
 * A person on the 3D court: a player in their side's kit, an official, a
 * coach — jointed exactly as playerRig.ts's skeleton, and shaped like a body.
 *
 * Every part is a smooth surface of revolution drawn round its bone and then
 * pushed out where the muscle is — the deltoid and biceps, the quads, the
 * calf behind the shin, the glutes, the chest and shoulder blades — with a
 * ball at each joint so a bent elbow or knee stays one surface instead of two
 * tubes meeting. The head is one sculpted surface — skull, cheekbones, the jaw
 * narrowing to the chin, the brow over the eye sockets, the nose, the lips —
 * under a face painted on it: brows, lips, a little colour in the cheeks, a
 * beard or stubble; glossy eyes with their irises under the upper lids; ears;
 * the hair over it. The hands have a palm, fingers and a thumb. The kit is a shirt with its
 * collar and short sleeves, the number on the back and the role's colour
 * across the shoulders; shorts cut at the thigh; knee pads as sleeves with
 * their cushion; crew socks; court shoes on a sole, a stripe in the trim
 * colour. Cloth has a satin sheen, skin a soft warm one where the light
 * grazes it. In the women's game the bodies are a woman's — and so is the
 * hair: a ponytail, a bun or a bob.
 *
 * The pieces each joint carries are merged into one mesh per material, so a
 * figure costs a few dozen draws however much detail it has — and the shapes
 * are built once per kind of body and shared.
 */

import {
  BoxGeometry, BufferGeometry, CanvasTexture, CapsuleGeometry, Color, CylinderGeometry, DoubleSide, Euler, Group,
  LatheGeometry, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry,
  Quaternion, SRGBColorSpace, TorusGeometry, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { womensGame } from './gameGender.ts';
import { BONES } from './playerRig.ts';
import type { Body } from './courtMotion.ts';

/** A side's playing colours. */
export interface Kit {
  shirt: string;
  shorts: string;
  /** Liberos wear a contrasting shirt, as the rules require. */
  libero: string;
}

/** How one person looks. */
export interface Look {
  kit: Kit;
  libero: boolean;
  /** Colour across the shoulders that tells the role at a glance. */
  trim: string;
  number: number;
  skin: string;
  hair: string;
  /** Men: 0 cropped, 1 short, 2 shaved. Women: 0 a ponytail, 1 a bun, 2 a bob. */
  hairStyle: number;
  /** Long trousers and dark shoes, for the officials and coaches. */
  trousers?: boolean;
  /** A woman's frame whatever the game is — a woman coaching in the men's. Absent: the game's. */
  women?: boolean;
  /** Sleeves to the wrist: a jacket, a tracksuit top, a shirt. */
  longSleeves?: boolean;
  /** What is on the front of the top, for a coach: a jacket's lapels over a shirt and tie, a buttoned
   *  shirt and tie, a tracksuit's zip, a polo's buttons. No pattern or side panels then. */
  front?: { kind: 'jacket' | 'shirt' | 'zip' | 'polo'; shirt?: string; tie?: string | null };
  /** None, stubble, or a full beard. */
  beard?: 0 | 1 | 2;
  /** The irises' colour. Absent: brown. */
  eyes?: string;
  glasses?: boolean;
  /** The shoes' colour, if not the usual. */
  shoes?: string;
}

// ---- Shaping -------------------------------------------------------------------------

/** A smooth bump between `a` and `b` (either order), 1 at the middle. */
function bump(t: number, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (t <= lo || t >= hi) return 0;
  return Math.sin(((t - lo) / (hi - lo)) * Math.PI);
}

/**
 * A surface of revolution round the bone, through (radius, height) points from
 * the bottom up; heights run down the limb from the joint (0) as negatives.
 * Its axis is `z`, the way the body's bones run; `y` is forward.
 */
function lathe(profile: ReadonlyArray<readonly [number, number]>, segments = 18): BufferGeometry {
  const g = new LatheGeometry(profile.map(([r, h]) => new Vector2(r, h)), segments);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Push every point of a shape about — a muscle out, a side in — then smooth its normals again. */
function shapeBy(g: BufferGeometry, f: (v: Vector3) => void): BufferGeometry {
  const p = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    f(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return weld(g);
}

/** Points that coincide — a lathe's seam, a pole — share one smoothed normal, so no edge shows down the back of a leg. */
function weld(g: BufferGeometry): BufferGeometry {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const sums = new Map<string, Vector3>();
  const key = (i: number): string => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    const s = sums.get(k) ?? new Vector3();
    s.x += n.getX(i);
    s.y += n.getY(i);
    s.z += n.getZ(i);
    sums.set(k, s);
  }
  for (let i = 0; i < p.count; i++) {
    const s = sums.get(key(i))!;
    const l = s.length() || 1;
    n.setXYZ(i, s.x / l, s.y / l, s.z / l);
  }
  n.needsUpdate = true;
  return g;
}

/** A shape moved, turned and stretched into place. */
function placed(g: BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): BufferGeometry {
  g.applyMatrix4(new Matrix4().makeScale(sx, sy, sz));
  g.applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

function ball(r: number, w = 18, h = 14): BufferGeometry {
  return new SphereGeometry(r, w, h);
}

// ---- The head ------------------------------------------------------------------------------

/** 1 at `c`, falling smoothly to nothing about `w` either side. */
function bell(t: number, c: number, w: number): number {
  const d = (t - c) / w;
  return Math.exp(-d * d);
}

/** 0 below `a`, 1 above `b`, smoothly between. */
function ramp(t: number, a: number, b: number): number {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/** The middle of the head, from the head's joint. */
const HEAD_MID = new Vector3(0, 0, 0.105);

/**
 * The face and skull as one surface: the point out along the unit direction (x across, y forward,
 * z up) from the middle of the head. A skull deeper than wide and taller than both, fuller behind;
 * the jaw narrowing under the cheekbones to the chin; a brow over the eye sockets; the nose, rising
 * from the bridge to its tip and wider there for the nostrils; the lips, the line between them, the
 * chin — all of it softer and a little smaller for a woman. A full beard fills out the jaw.
 */
function headPoint(x: number, y: number, z: number, women: boolean, beard: number, out = new Vector3()): Vector3 {
  const k = women ? 0.96 : 1;
  const soft = women ? 0.6 : 1;
  const front = ramp(y, 0.5, 0.85);
  const rx = 0.084 * (1 - (women ? 0.27 : 0.21) * ramp(-z, 0.2, 0.95));
  const ry = y > 0 ? 0.094 : 0.101;
  // Longer below the middle than above it: the jaw comes down to the neck.
  const rz = z > 0 ? 0.108 : 0.121;
  let d = 0;
  // The brow, and the sockets under it.
  d += 0.0065 * soft * front * bell(z, 0.29, 0.07) * bell(x, 0, 0.55);
  d -= 0.0055 * front * bell(z, 0.15, 0.07) * (bell(x, 0.34, 0.12) + bell(x, -0.34, 0.12));
  // Cheekbones.
  d += 0.0035 * bell(z, 0, 0.13) * (bell(x, 0.56, 0.16) + bell(x, -0.56, 0.16)) * ramp(y, 0.2, 0.6);
  // The nose: up from the bridge to its tip, wider there for the nostrils, then in under it.
  if (z < 0.24 && z > -0.36) {
    const t = Math.min(1, Math.max(0, (0.22 - z) / 0.39));
    const rise = z > -0.17 ? 0.0035 + 0.0175 * t ** 1.7 : 0.021 * bell(z, -0.17, 0.065);
    d += (women ? 0.8 : 1) * rise * bell(x, 0, 0.075 + 0.07 * bell(z, -0.19, 0.08)) * front;
  }
  // The lips, the line between them, and the chin.
  d += 0.0055 * front * bell(x, 0, 0.2) * (bell(z, -0.375, 0.045) + 0.95 * bell(z, -0.465, 0.05));
  d -= 0.0026 * front * bell(x, 0, 0.17) * bell(z, -0.42, 0.016);
  d += 0.0085 * soft * front * bell(x, 0, 0.28) * bell(z, -0.72, 0.12);
  if (beard === 2) d += 0.0045 * ramp(-z, 0.1, 0.35) * ramp(y, -0.3, 0.1);
  return out.set(x * (rx * k + d), y * (ry * k + d), z * (rz * k + d)).add(HEAD_MID);
}

/** The head's surface: a sphere moved out to it, its seam at the back, its texture's middle at the face. */
function headGeometry(women: boolean, beard: number): BufferGeometry {
  const g = new SphereGeometry(1, 64, 44).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
  const pos = g.getAttribute('position');
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    headPoint(p.x, p.y, p.z, women, beard, p);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Where each eye looks out from: a little apart, at the height of the cheekbones' top. */
function eyeDir(side: number): Vector3 {
  return new Vector3(side * 0.335, 0.925, 0.15).normalize();
}

/**
 * The eyes, set into their sockets: a glossy eyeball, the iris and the pupil on it looking ahead,
 * and the upper lid over the top of it, in the skin.
 */
function eyeParts(women: boolean): Array<[Slot, BufferGeometry]> {
  const out: Array<[Slot, BufferGeometry]> = [];
  // The lid over the top of the eye, its edge a little above the middle of it: the eye open.
  const lidUp = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(0, 0.34, 0.94).normalize());
  for (const side of [-1, 1]) {
    const dir = eyeDir(side);
    const c = headPoint(dir.x, dir.y, dir.z, women, 0).addScaledVector(dir, -0.0072);
    const ahead = new Vector3(side * 0.06, 1, 0).normalize();
    out.push(['white', placed(ball(0.0122, 18, 14), c.x, c.y, c.z)]);
    const iris = c.clone().addScaledVector(ahead, 0.0101);
    out.push(['iris', placed(ball(0.0067, 18, 12), iris.x, iris.y, iris.z, 1, 0.42, 1)]);
    const pupil = c.clone().addScaledVector(ahead, 0.0116);
    out.push(['pupil', placed(ball(0.0031, 12, 8), pupil.x, pupil.y, pupil.z, 1, 0.4, 1)]);
    const lid = new SphereGeometry(0.0132, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.31);
    lid.applyMatrix4(new Matrix4().makeRotationFromQuaternion(lidUp));
    out.push(['skin', lid.translate(c.x, c.y, c.z)]);
  }
  return out;
}

/** "#rrggbb" as 0-255 channels. */
function rgb(hex: string): [number, number, number] {
  const c = new Color(hex);
  const t = { r: 0, g: 0, b: 0 };
  c.getRGB(t, SRGBColorSpace);
  return [t.r * 255, t.g * 255, t.b * 255];
}

function mixRgb(a: readonly number[], b: readonly number[], k: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/**
 * The face, painted pixel by pixel round the head's surface (its middle at the face, the top of the
 * texture the crown): the skin, a shadow in the eye sockets and a little colour in the cheeks, the
 * brows in the hair's colour, the nostrils, the lips and the line between them; stubble, or a full
 * beard, over the jaw and chin and the upper lip.
 */
function faceTexture(skin: string, hair: string, beard: number, women: boolean): CanvasTexture {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const base = rgb(skin);
  const hairC = rgb(hair);
  const browC = mixRgb(hairC, [22, 15, 10], 0.25);
  const lipC = mixRgb(base, women ? [178, 72, 84] : [150, 82, 78], women ? 0.55 : 0.36);
  const shade = mixRgb(base, [40, 24, 18], 1);
  // A fixed grain for the stubble and the beard.
  let seed = 9;
  const grain = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let py = 0; py < H; py++) {
    const th = ((py + 0.5) / H) * Math.PI;
    const z = Math.cos(th);
    const sinTh = Math.sin(th);
    for (let px = 0; px < W; px++) {
      const ph = ((px + 0.5) / W) * Math.PI * 2;
      const x = Math.sin(ph) * sinTh;
      const y = -Math.cos(ph) * sinTh;
      let col: [number, number, number] = [base[0], base[1], base[2]];
      const noise = grain();
      if (y > -0.5) {
        const front = ramp(y, 0.45, 0.8);
        // Shadow in the sockets, colour in the cheeks.
        const sock = front * bell(z, 0.15, 0.08) * (bell(x, 0.34, 0.11) + bell(x, -0.34, 0.11));
        col = mixRgb(col, shade, 0.16 * sock);
        const blush = bell(z, -0.12, 0.12) * (bell(x, 0.5, 0.14) + bell(x, -0.5, 0.14));
        col = mixRgb(col, [206, 104, 94], (women ? 0.2 : 0.12) * blush);
        // The brows, arched, thicker towards the nose.
        const u = Math.abs(x);
        if (front > 0 && u > 0.12 && u < 0.6) {
          const zb = 0.29 + 0.03 * (1 - ((u - 0.36) / 0.2) ** 2);
          const thick = (women ? 0.014 : 0.023) * (1 - 0.45 * ((u - 0.14) / 0.42));
          const a = (1 - ramp(Math.abs(z - zb), thick * 0.55, thick)) * ramp(u, 0.13, 0.17) * ramp(0.58 - u, 0, 0.04) * front;
          col = mixRgb(col, browC, 0.9 * a);
        }
        // The nostrils.
        const nos = Math.min(1, ((u - 0.052) / 0.026) ** 2 + ((z + 0.215) / 0.012) ** 2);
        col = mixRgb(col, shade, 0.4 * (1 - ramp(nos, 0.5, 1)) * front);
        // The lips, and the line between them.
        const upper = ((x / 0.15) ** 2 + ((z + 0.392) / 0.028) ** 2);
        const lower = ((x / 0.14) ** 2 + ((z + 0.452) / 0.034) ** 2);
        const lip = (1 - ramp(Math.min(upper, lower), 0.7, 1.1)) * front;
        col = mixRgb(col, lipC, 0.85 * lip);
        if (Math.abs(z + 0.421) < 0.005 && u < 0.145) col = mixRgb(col, shade, 0.45 * front);
        // Stubble or a beard: the jaw and chin up to the cheek line, the upper lip, the sideburns.
        if (beard > 0) {
          const top = -0.06 - 0.24 * bell(x, 0, 0.35);
          let m = ramp(top - z, 0, 0.05) * ramp(z, -0.97, -0.9) * ramp(y, -0.45, -0.25);
          m = Math.max(m, ramp(u, 0.8, 0.88) * ramp(0.15 - z, 0, 0.05) * ramp(0.4 - Math.abs(y), 0, 0.1));
          m *= 1 - lip;
          col = beard === 2
            ? mixRgb(col, hairC, 0.92 * m * (0.82 + 0.18 * noise))
            : mixRgb(col, mixRgb(hairC, [20, 14, 10], 0.3), 0.42 * m * (0.55 + 0.45 * noise));
        }
      }
      const i = (py * W + px) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- The body's parts ------------------------------------------------------------------

/** What each joint carries, by the material it is drawn in. */
type Slot = 'skin' | 'face' | 'legs' | 'shirt' | 'plain' | 'sleeve' | 'trim' | 'shorts' | 'hair' | 'white' | 'iris' | 'pupil' | 'pad' | 'sock'
  | 'shoe' | 'sole' | 'frame';
type Joint = 'pelvis' | 'spine' | 'head' | 'shoulder0' | 'shoulder1' | 'elbow0' | 'elbow1' | 'hip0' | 'hip1' | 'knee0' | 'knee1' | 'ankle0' | 'ankle1';
type Parts = Map<Joint, Map<Slot, BufferGeometry>>;

/** The slots that throw a shadow: the big parts. Eyes, hair, socks and shoes are lost in it anyway. */
const CASTS: ReadonlySet<Slot> = new Set<Slot>(['skin', 'face', 'legs', 'shirt', 'plain', 'sleeve', 'shorts']);

interface Kind {
  women: boolean;
  hairStyle: number;
  trousers: boolean;
  longSleeves: boolean;
  beard: 0 | 1 | 2;
  glasses: boolean;
}

function buildParts(kind: Kind): Parts {
  const pieces = new Map<Joint, Map<Slot, BufferGeometry[]>>();
  const add = (joint: Joint, slot: Slot, g: BufferGeometry): void => {
    const bySlot = pieces.get(joint) ?? new Map<Slot, BufferGeometry[]>();
    pieces.set(joint, bySlot);
    const list = bySlot.get(slot) ?? [];
    bySlot.set(slot, list);
    // Only what every piece shares can be merged: positions, normals, texture coordinates.
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    list.push(g.index === null ? g : g.toNonIndexed());
  };
  const w = kind.women;
  // A woman's frame: a little slimmer through the limbs and shoulders, wider at the hips.
  const limbs = w ? 0.9 : 1;
  const legs: Slot = 'legs';

  // -- The pelvis: the shorts, round the hips and seat.
  const hips = w ? 1.05 : 1;
  add('pelvis', 'shorts', shapeBy(lathe([
    [0, -0.1], [0.07, -0.098], [0.13, -0.085], [0.162, -0.055], [0.168, -0.02], [0.157, 0.03], [0.148, 0.08], [0.144, 0.14], [0, 0.145],
  ], 24), (v) => {
    v.x *= hips;
    v.y *= 0.72;
    // The seat, behind; flatter at the front, and flat between the legs.
    if (v.y < 0) v.y *= 1 + 0.22 * bump(v.z, -0.12, 0.06);
    else v.y *= 1 - 0.1 * bump(v.z, -0.1, 0.12);
    if (v.z < -0.05) v.y *= 0.8;
  }));

  // -- The spine: the shirt's body, the collar, the neck.
  const chest = w ? 0.93 : 1;
  add('spine', 'shirt', shapeBy(lathe([
    [0.158, -0.085], [0.16, -0.075], [0.156, -0.04], [w ? 0.14 : 0.148, 0.04], [0.155, 0.16], [0.173, 0.28], [0.186, 0.38],
    [0.195, 0.44], [0.196, 0.49], [0.18, 0.53], [0.142, 0.562], [0.096, 0.585], [0.062, 0.598], [0, 0.604],
  ], 28), (v) => {
    const wide = v.z > 0.2 ? chest : 1;
    v.x *= wide;
    // Out over the shoulders to meet the arms.
    v.x *= 1 + (w ? 0.06 : 0.1) * bump(v.z, 0.36, 0.58);
    v.y *= 0.6;
    if (v.y > 0) {
      // The chest — or the bust.
      v.y *= w ? 1 + 0.2 * bump(v.z, 0.3, 0.47) : 1 + 0.12 * bump(v.z, 0.28, 0.52);
    } else {
      // The shoulder blades.
      v.y *= 1 + 0.07 * bump(v.z, 0.32, 0.56);
    }
  }));
  add('spine', 'trim', placed(new TorusGeometry(0.058, 0.0065, 6, 28), 0, 0.006, 0.596, 1, 0.84, 1));
  add('spine', 'skin', placed(new CylinderGeometry(0.051 * limbs, 0.054 * limbs, 0.15, 20).rotateX(Math.PI / 2), 0, 0.005, 0.612));

  // -- The head: the face and skull as one sculpted surface, the eyes in it, the ears — then the hair.
  const hs = w ? 0.96 : 1;
  add('head', 'face', headGeometry(w, kind.beard));
  for (const [slot, g] of eyeParts(w)) add('head', slot, g);
  for (const s of [-1, 1]) {
    add('head', 'skin', placed(ball(0.03, 14, 10), s * 0.083 * hs, -0.006, 0.1, 0.4, 0.62, 1.05, 0.12, 0, -s * 0.18));
  }
  const cap = (cover: number, r: number, sz = 1.1): BufferGeometry => {
    const g = new SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI * cover);
    g.rotateX(Math.PI / 2);
    g.rotateX(0.5);
    return placed(g, 0, -0.012, 0.108, 0.9 * hs, 1.0 * hs, sz * hs);
  };
  if (w) {
    add('head', 'hair', cap(0.56, 0.106, 1.12));
    if (kind.hairStyle === 0) {
      // A ponytail, from the crown down the back of the neck.
      add('head', 'hair', placed(new CapsuleGeometry(0.028, 0.16, 6, 12), 0, -0.112, 0.07, 1, 0.8, 1, -0.28, 0, 0));
      add('head', 'hair', placed(ball(0.03, 12, 10), 0, -0.095, 0.15, 1, 0.9, 0.8));
    } else if (kind.hairStyle === 1) {
      add('head', 'hair', placed(ball(0.046, 16, 12), 0, -0.088, 0.17, 1, 0.9, 0.85));
    } else {
      // A bob: down to the jaw all round.
      add('head', 'hair', cap(0.7, 0.11, 1.16));
    }
  } else if (kind.hairStyle === 0) {
    add('head', 'hair', cap(0.5, 0.104));
  } else if (kind.hairStyle === 1) {
    add('head', 'hair', cap(0.52, 0.1045, 1.13));
    // A little volume on top, swept back.
    add('head', 'hair', placed(ball(0.062, 18, 12), 0, -0.004, 0.19, 1.12, 1.2, 0.3));
  } else {
    // Shaved: a shadow of stubble over the scalp.
    add('head', 'hair', cap(0.48, 0.1015, 1.09));
  }

  if (kind.glasses) {
    // Round rims over the eyes, the bridge between them, and the arms back over the ears.
    for (const s of [-1, 1]) {
      add('head', 'frame', placed(new TorusGeometry(0.0168, 0.0023, 6, 20).rotateX(Math.PI / 2), s * 0.031, 0.104, 0.118));
      add('head', 'frame', placed(new BoxGeometry(0.003, 0.108, 0.003), s * 0.068, 0.05, 0.121, 1, 1, 1, 0, 0, s * 0.38));
    }
    add('head', 'frame', placed(new BoxGeometry(0.03, 0.003, 0.003), 0, 0.106, 0.121));
  }

  // Sleeves to the wrist cover the arm; the hands stay bare.
  const arm: Slot = kind.longSleeves ? 'plain' : 'skin';
  ([0, 1] as const).forEach((i) => {
    const side = i === 0 ? -1 : 1;
    const sh = `shoulder${i}` as Joint;
    const el = `elbow${i}` as Joint;
    const hp = `hip${i}` as Joint;
    const kn = `knee${i}` as Joint;
    const an = `ankle${i}` as Joint;

    // -- The arm: a shirt-covered shoulder, the sleeve, the upper arm.
    add(sh, 'plain', placed(ball(0.06 * limbs, 24, 18), -side * 0.01, 0, -0.012, 1.05, 1.08, 0.98));
    // The sleeve: round the deltoid, closed over the top of it, to a hem above the elbow.
    add(sh, 'sleeve', lathe([
      [0.06 * limbs, -0.15], [0.064 * limbs, -0.145], [0.065 * limbs, -0.1], [0.065 * limbs, -0.04], [0.061 * limbs, 0.0], [0.046 * limbs, 0.036], [0, 0.05],
    ], 24));
    const sleeved = kind.longSleeves ? 1.12 : 1;
    add(sh, arm, shapeBy(lathe([
      [0, -0.37], [0.038, -0.355], [0.044, -0.3], [0.052, -0.22], [0.059, -0.13], [0.06, -0.05], [0.054, 0.01], [0, 0.02],
    ].map(([r, h]) => [r * limbs * sleeved, h] as const), 22), (v) => {
      // Biceps in front, triceps behind.
      if (v.y > 0) v.y *= 1 + 0.14 * bump(v.z, -0.08, -0.28);
      else v.y *= 1 + 0.06 * bump(v.z, -0.04, -0.22);
    }));
    add(el, arm, ball(0.038 * limbs * sleeved));
    add(el, arm, shapeBy(lathe([
      [0, -0.31], [0.025, -0.3], [0.027, -0.29], [0.034, -0.22], [0.042, -0.13], [0.045, -0.06], [0.04, 0], [0, 0.02],
    ].map(([r, h]) => [r * limbs * (kind.longSleeves ? 1.18 : 1), h] as const), 18), (v) => { v.x *= 1.06; v.y *= 0.9; }));
    // -- The hand: palm, fingers, thumb (towards the body).
    const palmZ = -BONES.forearm - 0.05;
    add(el, 'skin', placed(ball(0.026 * limbs, 12, 10), 0, 0, -BONES.forearm));
    add(el, 'skin', placed(ball(0.04, 16, 12), 0, 0.004, palmZ + 0.004, 1.0 * limbs, 0.44, 1.08));
    ([[-0.021, 0.036], [-0.007, 0.044], [0.007, 0.042], [0.021, 0.034]] as const).forEach(([x, len], k) => {
      const finger = new CapsuleGeometry(0.0082 * limbs, len, 4, 8).rotateX(Math.PI / 2);
      add(el, 'skin', placed(finger, x * limbs * side, 0.011, palmZ - 0.036 - len / 2, 1, 1, 1, 0.22 + 0.04 * k, 0, 0));
    });
    add(el, 'skin', placed(new CapsuleGeometry(0.0105, 0.04, 4, 8), -side * 0.034 * limbs, 0.016, palmZ - 0.004, 1, 1, 1, 0.45, 0, side * 0.5));

    // -- The leg: the shorts' leg, the thigh, knee and pad, shin and calf, sock, shoe.
    // Loose enough over the thigh — its quads included — never to show through.
    add(hp, 'shorts', shapeBy(lathe([
      [0.095, -0.222], [0.103, -0.216], [0.106, -0.15], [0.108 * hips, -0.05], [0.106 * hips, 0.04], [0.084, 0.1],
    ], 24), (v) => { if (v.y > 0) v.y *= 1.1; }));
    const leg = kind.trousers ? 1.12 : 1;
    add(hp, legs, shapeBy(lathe([
      [0, -0.48], [0.05, -0.47], [0.055, -0.45], [0.064, -0.4], [0.078, -0.3], [0.088, -0.2], [0.094, -0.1], [0.093, -0.02], [0.074, 0.02], [0, 0.03],
    ].map(([r, h]) => [r * limbs * leg, h] as const), 24), (v) => {
      if (kind.trousers) return;
      // The quads in front, the hamstrings behind.
      if (v.y > 0) v.y *= 1 + 0.13 * bump(v.z, -0.08, -0.38);
      else v.y *= 1 + 0.05 * bump(v.z, -0.1, -0.33);
    }));
    add(kn, legs, placed(ball(0.053 * limbs * leg, 18, 14), 0, 0.004, 0));
    if (!kind.trousers) {
      add(kn, 'pad', lathe([[0.063, -0.09], [0.069, -0.08], [0.071, -0.04], [0.071, 0.02], [0.066, 0.06]], 18));
      add(kn, 'pad', placed(ball(0.05, 16, 12), 0, 0.044, -0.012, 0.95, 0.62, 1.1));
    }
    add(kn, legs, shapeBy(lathe([
      [0, -0.48], [0.031, -0.47], [0.034, -0.42], [0.041, -0.33], [0.05, -0.24], [0.057, -0.16], [0.058, -0.1], [0.054, -0.04], [0.05, 0.01], [0, 0.02],
    ].map(([r, h]) => [r * limbs * (kind.trousers ? 1.18 : 1), h] as const), 22), (v) => {
      if (kind.trousers) return;
      // The calf behind; the shin bone flatter in front.
      if (v.y < 0) v.y *= 1 + 0.34 * bump(v.z, -0.05, -0.3);
      else v.y *= 0.95;
    }));
    add(kn, kind.trousers ? legs : 'sock', lathe([
      [0.037, -0.476], [0.039, -0.44], [0.044 * limbs, -0.38], [0.047 * limbs, -0.335], [0.046 * limbs, -0.33],
    ], 18));
    add(an, kind.trousers ? legs : 'sock', ball(0.037, 14, 12));
    // The shoe: an upper from heel to toe, the sole under it, a stripe each side.
    const foot = (scale: number): BufferGeometry => {
      const g = new LatheGeometry([[0, -0.075], [0.035, -0.07], [0.048, -0.04], [0.052, 0.02], [0.05, 0.1], [0.04, 0.16], [0.02, 0.185], [0, 0.19]]
        .map(([r, y]) => new Vector2(r * scale, y * scale)), 26);
      return g;
    };
    // The upper: flat underneath; up round the heel and the ankle, down to the toe.
    add(an, 'shoe', shapeBy(placed(foot(1), 0, 0, 0, 1.02, 1, 1), (v) => {
      if (v.z < 0) v.z *= 0.3;
      else v.z *= 0.9 + 0.55 * bump(v.y, -0.09, 0.07) - 0.25 * ramp(v.y, 0.08, 0.19);
      v.y += 0.05;
      v.z += -BONES.ankle + 0.038;
    }));
    // The sole, its toe sprung up a little.
    add(an, 'sole', shapeBy(placed(foot(1.05), 0, 0, 0, 1.04, 1, 0.22), (v) => {
      v.z += 0.012 * ramp(v.y, 0.1, 0.2);
      v.y += 0.05;
      v.z += -BONES.ankle + 0.013;
    }));
    // The padded collar round the ankle.
    add(an, 'shoe', placed(new TorusGeometry(0.042, 0.009, 8, 22), 0, 0.006, -BONES.ankle + 0.074, 1, 1.18, 1, 0.12, 0, 0));
    // The stripe each side, sweeping up to the laces — on a court shoe.
    if (!kind.trousers) {
      for (const s of [-1, 1]) {
        add(an, 'trim', placed(new CapsuleGeometry(0.008, 0.075, 3, 8), s * 0.051, 0.055, -BONES.ankle + 0.05, 1, 1, 1, 0, 0, 0.4 * s));
        add(an, 'trim', placed(new CapsuleGeometry(0.006, 0.045, 3, 8), s * 0.046, 0.03, -BONES.ankle + 0.07, 1, 1, 1, 0.9, 0, 0.3 * s));
      }
    }
  });

  const parts: Parts = new Map();
  for (const [joint, bySlot] of pieces) {
    const merged = new Map<Slot, BufferGeometry>();
    for (const [slot, list] of bySlot) {
      const g = mergeGeometries(list, false);
      if (g !== null) {
        g.computeBoundingSphere();
        merged.set(slot, g);
      }
      for (const piece of list) piece.dispose();
    }
    parts.set(joint, merged);
  }
  return parts;
}

const PARTS = new Map<string, Parts>();

function partsFor(kind: Kind): Parts {
  const key = `${kind.women}:${kind.hairStyle}:${kind.trousers}:${kind.longSleeves}:${kind.beard}:${kind.glasses}`;
  let p = PARTS.get(key);
  if (p === undefined) PARTS.set(key, p = buildParts(kind));
  return p;
}

// ---- The kit's textures ------------------------------------------------------------------

function lighter(hex: string, by: number): string {
  const c = new Color(hex);
  c.lerp(new Color('#ffffff'), by);
  return `#${c.getHexString()}`;
}

function darker(hex: string, by: number): string {
  const c = new Color(hex);
  c.lerp(new Color('#000000'), by);
  return `#${c.getHexString()}`;
}

/** The shirt, wrapped round the body: the number big on the back and small on
 *  the front, the role's colour across the shoulders, darker side panels and a
 *  faint sublimated pattern. */
function shirtTexture(look: Look): CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const colour = look.libero ? look.kit.libero : look.kit.shirt;
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, S, S);
  if (look.front !== undefined) {
    drawFront(ctx, S, colour, look);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }
  // A faint diagonal pattern in the cloth.
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = lighter(colour, 0.6);
  ctx.lineWidth = 10;
  for (let x = -S; x < S * 2; x += 34) {
    ctx.beginPath();
    ctx.moveTo(x, S);
    ctx.lineTo(x + S * 0.6, 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Side panels, under the arms (a quarter of the way round each way from the back).
  ctx.fillStyle = darker(colour, 0.22);
  for (const x of [0.25, 0.75]) ctx.fillRect(x * S - 22, 110, 44, S - 110);
  // The yoke over the shoulders, in the role's colour, with a thin edge under it.
  ctx.fillStyle = look.trim;
  ctx.fillRect(0, 0, S, 112);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fillRect(0, 112, S, 7);
  if (look.number > 0) {
    const light = new Color(colour).getHSL({ h: 0, s: 0, l: 0 }).l > 0.62;
    const ink = light ? '#10151d' : '#ffffff';
    const edge = light ? 'rgba(255,255,255,0.6)' : darker(colour, 0.55);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const write = (size: number, x: number, y: number): void => {
      ctx.font = `800 ${size}px "Segoe UI", system-ui, sans-serif`;
      ctx.lineWidth = size / 12;
      ctx.strokeStyle = edge;
      ctx.strokeText(String(look.number), x, y);
      ctx.fillStyle = ink;
      ctx.fillText(String(look.number), x, y);
    };
    // The back is where the wrap starts and ends, so its number is drawn at both edges.
    for (const x of [0, S]) write(170, x, 270);
    write(72, S / 2, 205);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * A coach's top, the front of it at the middle of the texture, the collar at the top: a jacket's
 * lapels either side of the shirt and tie, two buttons below; a shirt's placket and buttons, and its
 * tie; a tracksuit top's zip, with the colour over the shoulders; a polo's buttons under its collar.
 */
function drawFront(ctx: CanvasRenderingContext2D, S: number, colour: string, look: Look): void {
  const f = look.front!;
  const mid = S / 2;
  const tie = (top: number, bottom: number): void => {
    if (f.tie == null) return;
    ctx.fillStyle = f.tie;
    // The knot, then the blade down to its point.
    ctx.beginPath();
    ctx.moveTo(mid - 11, top);
    ctx.lineTo(mid + 11, top);
    ctx.lineTo(mid + 8, top + 26);
    ctx.lineTo(mid - 8, top + 26);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(mid - 8, top + 26);
    ctx.lineTo(mid + 8, top + 26);
    ctx.lineTo(mid + 17, bottom - 24);
    ctx.lineTo(mid, bottom);
    ctx.lineTo(mid - 17, bottom - 24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(mid - 9, top + 24, 18, 4);
  };
  const button = (y: number, r: number, fill: string): void => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(mid, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  if (f.kind === 'jacket') {
    // The shirt showing in the V, and the tie over it.
    ctx.fillStyle = f.shirt ?? '#f4f6f8';
    ctx.beginPath();
    ctx.moveTo(mid - 50, 40);
    ctx.lineTo(mid + 50, 40);
    ctx.lineTo(mid, 330);
    ctx.closePath();
    ctx.fill();
    tie(52, 318);
    // The lapels, a shade darker, along each side of the V.
    ctx.fillStyle = darker(colour, 0.28);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(mid + s * 50, 40);
      ctx.lineTo(mid + s * 96, 52);
      ctx.lineTo(mid + s * 26, 286);
      ctx.lineTo(mid, 330);
      ctx.closePath();
      ctx.fill();
    }
    button(360, 7, darker(colour, 0.5));
    button(420, 7, darker(colour, 0.5));
    // Pockets.
    ctx.fillStyle = darker(colour, 0.3);
    for (const s of [-1, 1]) ctx.fillRect(mid + s * 92 - 30, 400, 60, 6);
  } else if (f.kind === 'shirt') {
    ctx.fillStyle = darker(colour, 0.12);
    ctx.fillRect(mid - 9, 60, 18, S - 60);
    for (let y = 120; y < S; y += 62) button(y, 4, darker(colour, 0.35));
    tie(56, 330);
  } else if (f.kind === 'zip') {
    // The colour over the shoulders, and the zip from the collar down.
    ctx.fillStyle = look.trim;
    ctx.fillRect(0, 0, S, 104);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(mid - 2, 0, 4, S);
    ctx.fillStyle = '#d9dde3';
    ctx.fillRect(mid - 5, 92, 10, 26);
  } else {
    ctx.fillStyle = look.trim;
    ctx.fillRect(0, 0, S, 104);
    ctx.fillStyle = darker(colour, 0.15);
    ctx.fillRect(mid - 11, 104, 22, 110);
    for (const y of [130, 165, 200]) button(y, 4.5, '#f2f2f2');
  }
}

let strands: CanvasTexture | null = null;

/** Hair: fine streaks running front to back, shared by everyone's (the colour is the material's). */
function strandTexture(): CanvasTexture {
  if (strands !== null) return strands;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, 128, 128);
  // A fixed scatter: the same for every head, so the texture is made once.
  let seed = 7;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const x = rand() * 128;
    const y = rand() * 128;
    const l = 140 + rand() * 115;
    ctx.strokeStyle = `rgb(${l},${l},${l})`;
    ctx.lineWidth = 0.6 + rand();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 4, y + 6 + rand() * 14);
    ctx.stroke();
  }
  strands = new CanvasTexture(c);
  strands.colorSpace = SRGBColorSpace;
  return strands;
}

/** A sleeve: the shirt's colour, the role's colour at the cuff. */
function sleeveTexture(look: Look): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = look.libero ? look.kit.libero : look.kit.shirt;
  ctx.fillRect(0, 0, 16, 64);
  // The cuff is the bottom of the sleeve: the start of its lathe, the bottom of the texture. A long
  // sleeve carries on past it, so has none.
  if (look.longSleeves !== true) {
    ctx.fillStyle = look.trim;
    ctx.fillRect(0, 56, 16, 8);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

// ---- A figure ------------------------------------------------------------------------------

/** A line judge's flag: red and yellow quarters, as the FIVB has them. */
function flagTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d');
  if (ctx !== null) {
    ctx.fillStyle = '#e8c547';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#d63a3a';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillRect(16, 16, 16, 16);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Cloth: a satin sheen in its own colour where the light grazes it. */
function cloth(color: string, roughness: number, map?: CanvasTexture): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: map === undefined ? new Color(color) : new Color('#ffffff'), map: map ?? null, roughness, metalness: 0,
    sheen: 0.55, sheenRoughness: 0.5, sheenColor: new Color(lighter(color, 0.35)),
  });
}

export class Figure {
  readonly root = new Group();
  /** The whole body tipped about the feet: a dive, a sprawl, flat out on the floor. */
  private readonly tip = new Group();
  private readonly pelvis = new Group();
  private readonly spine = new Group();
  readonly head = new Group();
  private readonly shoulders: [Group, Group] = [new Group(), new Group()];
  private readonly elbows: [Group, Group] = [new Group(), new Group()];
  private readonly hips: [Group, Group] = [new Group(), new Group()];
  private readonly knees: [Group, Group] = [new Group(), new Group()];
  private readonly ankles: [Group, Group] = [new Group(), new Group()];
  private readonly slots = new Map<Slot, MeshPhysicalMaterial | MeshStandardMaterial>();
  private readonly materials: Array<MeshPhysicalMaterial | MeshStandardMaterial> = [];
  private alpha = 1;
  private kitKey: string;

  constructor(private look: Look) {
    const trousers = look.trousers === true;
    const kind: Kind = {
      women: look.women ?? womensGame(), hairStyle: Math.max(0, Math.min(2, look.hairStyle)), trousers,
      longSleeves: look.longSleeves === true, beard: look.beard ?? 0, glasses: look.glasses === true,
    };
    const parts = partsFor(kind);
    const shirt = look.libero ? look.kit.libero : look.kit.shirt;
    const skin = new MeshPhysicalMaterial({
      color: new Color(look.skin), roughness: 0.5, metalness: 0,
      // Light through the skin's edge: a warm sheen where it grazes.
      sheen: 0.4, sheenRoughness: 0.55, sheenColor: new Color(lighter(look.skin, 0.25)).multiply(new Color('#ffb59a')),
    });
    const shorts = cloth(look.kit.shorts, 0.55);
    // A shaved head shows the scalp through it: its stubble is half skin.
    const hairColour = kind.hairStyle === 2 && !kind.women
      ? `#${new Color(look.skin).lerp(new Color(look.hair), 0.55).getHexString()}`
      : look.hair;
    const std = (color: string, roughness: number): MeshStandardMaterial =>
      new MeshStandardMaterial({ color: new Color(color), roughness, metalness: 0 });
    this.slots.set('skin', skin);
    // The face: the same skin, painted.
    this.slots.set('face', new MeshPhysicalMaterial({
      map: faceTexture(look.skin, look.hair, kind.women ? 0 : kind.beard, kind.women), roughness: 0.52, metalness: 0,
      sheen: 0.4, sheenRoughness: 0.55, sheenColor: new Color(lighter(look.skin, 0.25)).multiply(new Color('#ffb59a')),
    }));
    this.slots.set('legs', trousers ? shorts : skin);
    this.slots.set('shirt', cloth(shirt, 0.6, shirtTexture(look)));
    this.slots.set('sleeve', cloth(shirt, 0.6, sleeveTexture(look)));
    this.slots.set('plain', cloth(shirt, 0.6));
    this.slots.set('trim', std(look.trim, 0.5));
    this.slots.set('shorts', shorts);
    const hair = std(hairColour, kind.hairStyle === 2 && !kind.women ? 0.85 : 0.62);
    // Strands: lighter and darker, and the surface broken up by them, so it reads as hair, not a cap.
    hair.map = strandTexture();
    hair.bumpMap = hair.map;
    hair.bumpScale = 0.9;
    this.slots.set('hair', hair);
    // Eyes that catch the light.
    const glossy = (color: string): MeshPhysicalMaterial =>
      new MeshPhysicalMaterial({ color: new Color(color), roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
    this.slots.set('white', glossy('#efeae2'));
    this.slots.set('iris', glossy(look.eyes ?? '#4a2c18'));
    this.slots.set('pupil', glossy('#0b0907'));
    this.slots.set('pad', std(look.number % 2 === 0 ? '#1b1f27' : '#e9ecf1', 0.85));
    this.slots.set('sock', cloth('#f2f4f7', 0.85));
    this.slots.set('shoe', new MeshPhysicalMaterial({ color: new Color(look.shoes ?? (trousers ? '#15181e' : '#f6f7f9')), roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.4 }));
    this.slots.set('frame', new MeshStandardMaterial({ color: new Color('#1b1d22'), roughness: 0.3, metalness: 0.5 }));
    // A court shoe's gum sole; a smart shoe's black one.
    this.slots.set('sole', std(trousers ? '#0d0f13' : '#a8794f', 0.7));
    this.materials.push(...new Set(this.slots.values()));
    this.kitKey = JSON.stringify(look.kit);

    const joints: Record<Joint, Group> = {
      pelvis: this.pelvis, spine: this.spine, head: this.head,
      shoulder0: this.shoulders[0], shoulder1: this.shoulders[1], elbow0: this.elbows[0], elbow1: this.elbows[1],
      hip0: this.hips[0], hip1: this.hips[1], knee0: this.knees[0], knee1: this.knees[1], ankle0: this.ankles[0], ankle1: this.ankles[1],
    };
    for (const [joint, bySlot] of parts) {
      for (const [slot, geo] of bySlot) {
        const mesh = new Mesh(geo, this.slots.get(slot)!);
        mesh.castShadow = CASTS.has(slot);
        joints[joint].add(mesh);
      }
    }

    this.root.add(this.tip);
    this.tip.add(this.pelvis);
    this.pelvis.add(this.spine);
    this.spine.position.z = BONES.spine;
    this.spine.add(this.head);
    this.head.position.z = BONES.neck;
    ([-1, 1] as const).forEach((side, i) => {
      const shoulder = this.shoulders[i];
      shoulder.position.set(side * BONES.shoulderOut, 0, BONES.shoulderUp);
      this.spine.add(shoulder);
      this.elbows[i].position.z = -BONES.upperArm;
      shoulder.add(this.elbows[i]);
      const hip = this.hips[i];
      hip.rotation.order = 'YXZ';
      hip.position.x = side * BONES.hipOut;
      this.pelvis.add(hip);
      this.knees[i].position.z = -BONES.thigh;
      hip.add(this.knees[i]);
      this.ankles[i].position.z = -BONES.shin;
      this.knees[i].add(this.ankles[i]);
    });
  }

  /** A line judge's flag in the right hand: a short stick on along the forearm, red and yellow at its end. */
  holdFlag(): void {
    const hand = this.elbows[1];
    const flag = new Group();
    flag.position.set(0, 0.01, -BONES.forearm - BONES.hand + 0.02);
    const stick = new Mesh(new CylinderGeometry(0.008, 0.008, 0.42, 6).rotateX(Math.PI / 2), new MeshStandardMaterial({ color: '#2b2b2b' }));
    stick.position.z = -0.16;
    flag.add(stick);
    const cloth = new Mesh(new PlaneGeometry(0.2, 0.28), new MeshStandardMaterial({ map: flagTexture(), side: DoubleSide, roughness: 0.8 }));
    cloth.rotation.y = Math.PI / 2;
    cloth.position.set(0, 0.1, -0.24);
    cloth.castShadow = true;
    flag.add(cloth);
    hand.add(flag);
  }

  /** Where the palms are, in court metres — for something held in them, a trophy over the head. */
  handsAt(a: Vector3, b: Vector3): void {
    this.root.updateMatrixWorld(true);
    for (const [v, i] of [[a, 0], [b, 1]] as const) {
      v.set(0, 0, -BONES.forearm - BONES.hand * 0.5);
      this.elbows[i].localToWorld(v);
    }
  }

  restyle(look: Look): void {
    if (look === this.look) return;
    const key = JSON.stringify(look.kit);
    if (key === this.kitKey && look.trim === this.look.trim) return;
    this.look = look;
    this.kitKey = key;
    const shirt = look.libero ? look.kit.libero : look.kit.shirt;
    for (const [slot, make] of [['shirt', shirtTexture], ['sleeve', sleeveTexture]] as const) {
      const m = this.slots.get(slot) as MeshPhysicalMaterial;
      m.map?.dispose();
      m.map = make(look);
      m.sheenColor.set(lighter(shirt, 0.35));
      m.needsUpdate = true;
    }
    const plain = this.slots.get('plain') as MeshPhysicalMaterial;
    plain.color.set(shirt);
    plain.sheenColor.set(lighter(shirt, 0.35));
    const shorts = this.slots.get('shorts') as MeshPhysicalMaterial;
    shorts.color.set(look.kit.shorts);
    shorts.sheenColor.set(lighter(look.kit.shorts, 0.35));
    this.slots.get('trim')!.color.set(look.trim);
  }

  /** Put the body where the motion has it, every joint at its angle. */
  pose(b: Pick<Body, 'x' | 'y' | 'lift' | 'yaw' | 'scale' | 'rig' | 'alpha'>): void {
    const r = b.rig;
    this.root.position.set(b.x, b.y, b.lift);
    this.root.rotation.set(0, 0, b.yaw);
    this.root.scale.setScalar(b.scale);
    this.tip.position.z = r.root.rise;
    this.tip.rotation.set(r.root.pitch, r.root.roll, 0);
    this.pelvis.position.set(0, r.pelvis.y, r.pelvis.z);
    this.pelvis.rotation.set(r.pelvis.pitch, 0, 0);
    this.spine.rotation.set(r.spine.x, r.spine.y, r.spine.z);
    this.head.rotation.set(r.head.x, 0, r.head.z);
    for (let i = 0; i < 2; i++) {
      const arm = r.arms[i];
      this.shoulders[i].position.z = BONES.shoulderUp + r.shoulderLift[i];
      this.shoulders[i].rotation.set(arm.x, arm.y, arm.z);
      this.elbows[i].rotation.set(arm.bend, 0, 0);
      const leg = r.legs[i];
      this.hips[i].rotation.set(leg.x, leg.y, 0);
      this.knees[i].rotation.set(-leg.bend, 0, 0);
      this.ankles[i].rotation.set(leg.end, 0, 0);
    }
    if (Math.abs(b.alpha - this.alpha) > 0.01 || (b.alpha >= 0.99 && this.alpha < 1)) {
      this.alpha = b.alpha >= 0.99 ? 1 : b.alpha;
      for (const m of this.materials) {
        const see = this.alpha < 1;
        if (m.transparent !== see) {
          m.transparent = see;
          m.needsUpdate = true;
        }
        m.opacity = this.alpha;
      }
    }
  }

  /** The figure's own materials and textures; its shapes are shared with every other of its kind. */
  dispose(): void {
    for (const m of this.materials) {
      if (m.map !== strands) m.map?.dispose();
      m.dispose();
    }
  }
}
