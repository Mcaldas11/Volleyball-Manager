/**
 * A person on the 3D court: a player in their side's kit, an official, a
 * coach — jointed exactly as playerRig.ts's skeleton, and shaped like a body.
 *
 * Every part is a smooth surface of revolution drawn round its bone and then
 * pushed out where the muscle is — the deltoid and biceps, the quads, the
 * calf behind the shin, the glutes, the chest and shoulder blades — with a
 * ball at each joint so a bent elbow or knee stays one surface instead of two
 * tubes meeting. The head has a jaw, a nose, ears, eyes and brows, under the
 * hair; the hands a palm, fingers and a thumb. The kit is a shirt with its
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
  SRGBColorSpace, TorusGeometry, Vector2, Vector3,
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

// ---- The body's parts ------------------------------------------------------------------

/** What each joint carries, by the material it is drawn in. */
type Slot = 'skin' | 'legs' | 'shirt' | 'plain' | 'sleeve' | 'trim' | 'shorts' | 'hair' | 'white' | 'iris' | 'pad' | 'sock' | 'shoe' | 'sole';
type Joint = 'pelvis' | 'spine' | 'head' | 'shoulder0' | 'shoulder1' | 'elbow0' | 'elbow1' | 'hip0' | 'hip1' | 'knee0' | 'knee1' | 'ankle0' | 'ankle1';
type Parts = Map<Joint, Map<Slot, BufferGeometry>>;

/** The slots that throw a shadow: the big parts. Eyes, hair, socks and shoes are lost in it anyway. */
const CASTS: ReadonlySet<Slot> = new Set<Slot>(['skin', 'legs', 'shirt', 'plain', 'sleeve', 'shorts']);

interface Kind {
  women: boolean;
  hairStyle: number;
  trousers: boolean;
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
    [0, -0.14], [0.1, -0.135], [0.15, -0.1], [0.168, -0.06], [0.168, -0.02], [0.155, 0.03], [0.146, 0.08], [0.142, 0.14], [0, 0.145],
  ], 18), (v) => {
    v.x *= hips;
    v.y *= 0.72;
    // The seat, behind; flatter at the front.
    if (v.y < 0) v.y *= 1 + 0.22 * bump(v.z, -0.15, 0.06);
    else v.y *= 1 - 0.06 * bump(v.z, -0.12, 0.12);
  }));

  // -- The spine: the shirt's body, the collar, the neck.
  const chest = w ? 0.93 : 1;
  add('spine', 'shirt', shapeBy(lathe([
    [0.158, -0.085], [0.16, -0.075], [0.156, -0.04], [w ? 0.14 : 0.148, 0.04], [0.155, 0.16], [0.173, 0.28], [0.186, 0.38],
    [0.195, 0.44], [0.19, 0.49], [0.165, 0.535], [0.12, 0.568], [0.08, 0.59], [0.058, 0.6], [0, 0.604],
  ], 18), (v) => {
    const wide = v.z > 0.2 ? chest : 1;
    v.x *= wide;
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
  add('spine', 'skin', placed(new CylinderGeometry(0.046 * limbs, 0.054 * limbs, 0.15, 18).rotateX(Math.PI / 2), 0, 0.006, 0.612));

  // -- The head: skull, jaw, nose, ears, eyes and brows — then the hair.
  const hs = w ? 0.96 : 1;
  add('head', 'skin', placed(ball(0.1, 24, 18), 0, 0, 0.105, 0.88 * hs, 0.98 * hs, 1.08 * hs));
  add('head', 'skin', placed(ball(0.06, 18, 12), 0, 0.034, 0.037, w ? 0.95 : 1.06, 1, 0.85));
  add('head', 'skin', placed(ball(0.02, 10, 8), 0, 0.097, 0.094, 0.62, 0.95, 1.35));
  for (const s of [-1, 1]) {
    add('head', 'skin', placed(ball(0.03, 10, 8), s * 0.086 * hs, -0.004, 0.1, 0.36, 0.62, 1));
    add('head', 'white', placed(ball(0.012, 10, 8), s * 0.031, 0.083, 0.118));
    add('head', 'iris', placed(ball(0.0075, 8, 6), s * 0.031, 0.093, 0.118));
    add('head', 'hair', placed(new BoxGeometry(0.032, 0.008, 0.008), s * 0.032, 0.091, 0.137, 1, 1, 1, 0, s * 0.12, 0));
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
    add('head', 'hair', placed(ball(0.06, 16, 10), 0, 0.02, 0.185, 1.15, 1.15, 0.32));
  } else {
    // Shaved: a shadow of stubble over the scalp.
    add('head', 'hair', cap(0.48, 0.1015, 1.09));
  }

  ([0, 1] as const).forEach((i) => {
    const side = i === 0 ? -1 : 1;
    const sh = `shoulder${i}` as Joint;
    const el = `elbow${i}` as Joint;
    const hp = `hip${i}` as Joint;
    const kn = `knee${i}` as Joint;
    const an = `ankle${i}` as Joint;

    // -- The arm: a shirt-covered shoulder, the sleeve, the upper arm.
    add(sh, 'plain', placed(ball(0.056 * limbs, 22, 16), -side * 0.012, 0, -0.016, 1.05, 1.05, 0.95));
    add(sh, 'sleeve', lathe([[0.06 * limbs, -0.155], [0.065 * limbs, -0.15], [0.066 * limbs, -0.1], [0.064 * limbs, -0.03], [0.058 * limbs, 0.02]], 18));
    add(sh, 'skin', shapeBy(lathe([
      [0, -0.37], [0.037, -0.355], [0.042, -0.3], [0.049, -0.22], [0.055, -0.13], [0.056, -0.05], [0.05, 0.01], [0, 0.02],
    ].map(([r, h]) => [r * limbs, h] as const), 20), (v) => {
      // Biceps in front, triceps behind.
      if (v.y > 0) v.y *= 1 + 0.14 * bump(v.z, -0.08, -0.28);
      else v.y *= 1 + 0.06 * bump(v.z, -0.04, -0.22);
    }));
    add(el, 'skin', ball(0.038 * limbs));
    add(el, 'skin', shapeBy(lathe([
      [0, -0.31], [0.025, -0.3], [0.027, -0.29], [0.034, -0.22], [0.042, -0.13], [0.045, -0.06], [0.04, 0], [0, 0.02],
    ].map(([r, h]) => [r * limbs, h] as const), 18), (v) => { v.x *= 1.06; v.y *= 0.9; }));
    // -- The hand: palm, fingers, thumb (towards the body).
    const palmZ = -BONES.forearm - 0.05;
    add(el, 'skin', placed(ball(0.026 * limbs, 12, 10), 0, 0, -BONES.forearm));
    add(el, 'skin', placed(ball(0.04, 14, 10), 0, 0.004, palmZ, 1.0 * limbs, 0.46, 1.2));
    add(el, 'skin', placed(ball(0.036, 14, 10), 0, 0.01, palmZ - 0.055, 1.0 * limbs, 0.42, 1.15, 0.18, 0, 0));
    add(el, 'skin', placed(new CapsuleGeometry(0.011, 0.04, 4, 8), -side * 0.034 * limbs, 0.012, palmZ + 0.002, 1, 1, 1, 0.3, 0, side * 0.5));

    // -- The leg: the shorts' leg, the thigh, knee and pad, shin and calf, sock, shoe.
    add(hp, 'shorts', lathe([[0.086, -0.222], [0.093, -0.216], [0.096, -0.15], [0.1 * hips, -0.05], [0.1 * hips, 0.04], [0.08, 0.1]], 18));
    const leg = kind.trousers ? 1.12 : 1;
    add(hp, legs, shapeBy(lathe([
      [0, -0.48], [0.05, -0.47], [0.054, -0.45], [0.062, -0.4], [0.074, -0.3], [0.083, -0.2], [0.088, -0.1], [0.087, -0.02], [0.07, 0.02], [0, 0.03],
    ].map(([r, h]) => [r * limbs * leg, h] as const), 22), (v) => {
      if (kind.trousers) return;
      // The quads in front, the hamstrings behind.
      if (v.y > 0) v.y *= 1 + 0.1 * bump(v.z, -0.08, -0.38);
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
        .map(([r, y]) => new Vector2(r * scale, y * scale)), 22);
      return g;
    };
    add(an, 'shoe', placed(foot(1), 0, 0.05, -BONES.ankle + 0.042, 1.02, 1, 0.78));
    add(an, 'sole', placed(foot(1.04), 0, 0.05, -BONES.ankle + 0.014, 1.04, 1, 0.24));
    for (const s of [-1, 1]) {
      add(an, 'trim', placed(new CapsuleGeometry(0.007, 0.07, 3, 6), s * 0.05, 0.06, -BONES.ankle + 0.045, 1, 1, 1, 0, 0, 0.35 * s));
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
  const key = `${kind.women}:${kind.hairStyle}:${kind.trousers}`;
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
  // The cuff is the bottom of the sleeve: the start of its lathe, the bottom of the texture.
  ctx.fillStyle = look.trim;
  ctx.fillRect(0, 56, 16, 8);
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
    const kind: Kind = { women: womensGame(), hairStyle: Math.max(0, Math.min(2, look.hairStyle)), trousers };
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
    hair.bumpScale = 1.6;
    this.slots.set('hair', hair);
    this.slots.set('white', std('#efebe4', 0.3));
    this.slots.set('iris', std('#1d140e', 0.25));
    this.slots.set('pad', std(look.number % 2 === 0 ? '#1b1f27' : '#e9ecf1', 0.85));
    this.slots.set('sock', cloth('#f2f4f7', 0.85));
    this.slots.set('shoe', new MeshPhysicalMaterial({ color: new Color(trousers ? '#15181e' : '#f6f7f9'), roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.4 }));
    this.slots.set('sole', std(trousers ? '#0d0f13' : '#d8d2c5', 0.7));
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
