/**
 * The crowd in the far stand: rows of seats, and people in them — each one a
 * little body with a head, hair, arms and legs, in the shirt of the side they
 * came for. The home support fills the stand; the away fans have their own
 * block at one end, packed tight and loud; the neutrals are scattered
 * through it all. How full it is depends on the match.
 *
 * When a side wins a point its fans come alive — up on their feet, arms in
 * the air, scarves held high, clapping — a wave running along the rows
 * rather than everyone at once, and longer and louder for a spike put away,
 * a block or an ace. Neutrals give it a polite round of applause.
 *
 * Thousands of them are drawn in a handful of calls: every body part is an
 * instanced mesh, and only the fans who are moving have their matrices
 * rewritten each frame.
 */

import {
  BoxGeometry, Color, CylinderGeometry, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshLambertMaterial,
  SphereGeometry, type BufferGeometry,
} from 'three';
import type { Kit } from './court3d.ts';

/** The stand: where its front row sits, how many rows climb back, and how the seats are spaced. */
const ROWS = 20;
const FRONT_X = -8.2;
const ROW_DEPTH = 0.8;
const ROW_RISE = 0.6;
const FRONT_Z = 1.42;
const SEAT_GAP = 0.62;
const SPAN = 31;
/** The away end: a block of the stand on the positive side. */
const AWAY_BLOCK: readonly [number, number] = [11.5, 23];

/** A point won, for the stands. */
export interface Cheer {
  team: 0 | 1;
  t0: number;
  big: boolean;
}

const SKIN = ['#f1c9a5', '#e0ac85', '#c98e64', '#a86f48', '#7c4f31', '#5a3a24'];
const HAIR = ['#1b1410', '#2e1f16', '#4a3020', '#7a5230', '#b48a55', '#d8c08c', '#8c8c8c', '#3b2a22'];
const NEUTRAL_SHIRTS = ['#e9ecf1', '#2a3342', '#4a5568', '#1d2633', '#8a95a5', '#c7b89a', '#5a6b4e', '#7a3b3b', '#3b4f7a', '#d0d4da'];
const SEAT = '#273140';

/** One of the crowd. */
interface Fan {
  x: number;
  y: number;
  z: number;
  /** 0 home, 1 away, 2 neutral. */
  side: 0 | 1 | 2;
  /** How they celebrate: jump, stand and clap, wave both arms, hold the scarf up. */
  style: 0 | 1 | 2 | 3;
  scarf: boolean;
  /** How much a point gets them going, and how long after the others. */
  keen: number;
  delay: number;
  /** Their own shade of the team's colour, or their own shirt. */
  shade: number;
  shirt: string;
  /** Row shading: the back of the stand is in the dark. */
  dim: number;
}

/** A small fixed-seed generator: the same people in the same seats every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)];
}

/** A geometry hanging from its top, for an arm: the joint at the origin, the rest down -z. */
function hanging(g: BufferGeometry, length: number): BufferGeometry {
  return g.translate(0, 0, -length / 2);
}

export class Crowd {
  readonly group = new Group();
  private readonly fans: Fan[] = [];
  private readonly torso: InstancedMesh;
  private readonly head: InstancedMesh;
  private readonly hair: InstancedMesh;
  private readonly legs: InstancedMesh;
  private readonly arms: InstancedMesh;
  private readonly scarves: InstancedMesh;
  private readonly seats: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly r = new Matrix4();
  private readonly colour = new Color();
  private cheer: Cheer | null = null;
  /** Whether anyone was moving last frame — once all are still, nothing needs redrawing. */
  private moving = true;
  private key = '';

  /** `fill` is how full the stand is, 0-1. */
  constructor(fill: number) {
    const r = seeded(20260728);
    const seatSpots: Array<[number, number, number]> = [];
    for (let row = 0; row < ROWS; row++) {
      const x = FRONT_X - row * ROW_DEPTH;
      const z = FRONT_Z + row * ROW_RISE;
      const dim = 0.95 - row * 0.022;
      for (let y = -SPAN; y <= SPAN; y += SEAT_GAP) {
        seatSpots.push([x, y, z]);
        // Fuller near the middle, where the view is best — and the away block packed.
        const away = y >= AWAY_BLOCK[0] && y <= AWAY_BLOCK[1];
        const centre = 1 - Math.min(1, Math.abs(y) / SPAN) * 0.25;
        if (r() > Math.min(0.98, fill * (away ? 1.12 : centre))) continue;
        const roll = r();
        const side: 0 | 1 | 2 = away
          ? (roll < 0.82 ? 1 : roll < 0.95 ? 2 : 0)
          : (roll < 0.7 ? 0 : roll < 0.95 ? 2 : 1);
        const scarf = side !== 2 && r() < 0.32;
        this.fans.push({
          x: x + (r() - 0.5) * 0.06, y: y + (r() - 0.5) * 0.1, z, side,
          style: (scarf && r() < 0.6 ? 3 : Math.floor(r() * 3)) as 0 | 1 | 2 | 3,
          scarf, keen: 0.55 + r() * 0.45, delay: r() * 260 + Math.abs(y) * 4,
          shade: (r() - 0.5) * 0.16,
          shirt: side === 2 || r() < 0.22 ? pick(r, NEUTRAL_SHIRTS) : '',
          dim,
        });
      }
    }

    const mat = (): MeshLambertMaterial => new MeshLambertMaterial({ color: '#ffffff' });
    const n = this.fans.length;
    const make = (geo: BufferGeometry, count: number, dynamic = true): InstancedMesh => {
      const mesh = new InstancedMesh(geo, mat(), count);
      if (dynamic) mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    // A seat: the pan and its back in one block, low and dark.
    const seat = new BoxGeometry(0.42, 0.46, 0.4).translate(-0.02, 0, 0.2);
    this.seats = make(seat, seatSpots.length, false);
    this.torso = make(new CylinderGeometry(0.2, 0.17, 0.58, 8).rotateX(Math.PI / 2).scale(0.62, 1, 1), n);
    this.head = make(new SphereGeometry(0.11, 10, 8), n);
    this.hair = make(new SphereGeometry(0.118, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(Math.PI / 2), n);
    this.legs = make(new BoxGeometry(1, 1, 1), n);
    this.arms = make(hanging(new BoxGeometry(0.085, 0.085, 0.56), 0.56), n * 2);
    this.scarves = make(new BoxGeometry(1, 1, 1), n);

    seatSpots.forEach(([x, y, z], i) => {
      this.m.makeTranslation(x, y, z);
      this.seats.setMatrixAt(i, this.m);
      this.seats.setColorAt(i, this.colour.set(SEAT).multiplyScalar(0.8 + 0.2 * ((i * 7) % 5) / 5));
    });
    // Skin and hair don't change with the kits.
    const look = seeded(99173);
    this.fans.forEach((f, i) => {
      const skin = pick(look, SKIN);
      this.head.setColorAt(i, this.colour.set(skin).multiplyScalar(f.dim));
      this.hair.setColorAt(i, this.colour.set(pick(look, HAIR)).multiplyScalar(f.dim));
      this.legs.setColorAt(i, this.colour.set(look() < 0.6 ? '#1f2633' : '#3a4a66').multiplyScalar(f.dim));
    });
  }

  /** Dress the fans in their sides' colours. */
  setKits(kits: [Kit, Kit]): void {
    const key = kits[0].shirt + kits[1].shirt;
    if (key === this.key) return;
    this.key = key;
    this.fans.forEach((f, i) => {
      const team = f.side === 2 ? null : kits[f.side].shirt;
      const shirt = f.shirt !== '' || team === null ? f.shirt : team;
      this.colour.set(shirt);
      if (f.shirt === '') this.colour.offsetHSL(0, 0, f.shade);
      this.colour.multiplyScalar(f.dim);
      this.torso.setColorAt(i, this.colour);
      this.arms.setColorAt(i * 2, this.colour);
      this.arms.setColorAt(i * 2 + 1, this.colour);
      this.scarves.setColorAt(i, this.colour.set(team ?? '#888888').multiplyScalar(f.dim));
    });
    for (const mesh of [this.torso, this.arms, this.scarves]) {
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
    this.moving = true;
  }

  /** The point just won, if it is new. */
  react(cheer: Cheer | null): void {
    if (cheer === null || cheer === this.cheer) return;
    this.cheer = cheer;
    this.moving = true;
  }

  /** Move everyone on to `now`. */
  update(now: number): void {
    const c = this.cheer;
    const length = c === null ? 0 : c.big ? 3400 : 2400;
    const active = c !== null && now - c.t0 < length + 600;
    if (!active && !this.moving) return;
    this.moving = active;

    for (let i = 0; i < this.fans.length; i++) {
      const f = this.fans[i];
      // How worked up they are right now: up fast, down slow.
      let e = 0;
      if (c !== null) {
        const t = now - c.t0 - f.delay;
        const env = t <= 0 ? 0 : t < 250 ? t / 250 : Math.max(0, 1 - (t - 250) / length);
        const theirs = f.side === c.team ? 1 : f.side === 2 ? 0.3 : 0;
        e = env * theirs * f.keen * (c.big ? 1 : 0.7);
      }
      this.pose(i, f, e, now);
    }
    for (const mesh of [this.torso, this.head, this.hair, this.legs, this.arms, this.scarves]) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** One fan, `e` worked up (0 sitting quietly, 1 on their feet going wild). */
  private pose(i: number, f: Fan, e: number, now: number): void {
    const m = this.m;
    // On their feet once it's more than polite applause.
    const up = Math.min(1, Math.max(0, (e - 0.25) / 0.35));
    const bounce = f.style === 0 && up > 0.5 ? Math.abs(Math.sin((now + f.delay * 3) / 170)) * 0.16 * up : 0;
    const lift = 0.42 * up + bounce;
    const fwd = 0.08 * up;
    const x = f.x + fwd;
    const z = f.z + lift;

    m.makeTranslation(x, f.y, z + 0.74);
    this.torso.setMatrixAt(i, m);
    m.makeTranslation(x, f.y, z + 1.18);
    this.head.setMatrixAt(i, m);
    m.makeTranslation(x - 0.012, f.y, z + 1.19);
    this.hair.setMatrixAt(i, m);

    // Legs: thighs out along the seat, or straight down once standing.
    const lx = 0.42 + (0.17 - 0.42) * up;
    const lz = 0.14 + (0.86 - 0.14) * up;
    m.makeScale(lx, 0.32, lz).setPosition(f.x + 0.17 * (1 - up) + 0.04 * up, f.y, f.z + 0.47 * (1 - up) + (0.43 + bounce) * up);
    this.legs.setMatrixAt(i, m);

    // Arms: resting on the lap; clapping in front; up and waving; up holding the scarf.
    let pitch = 0.55;
    let roll = 0.08;
    const t = now + f.delay * 5;
    if (e > 0.05) {
      if (f.style === 1 || e < 0.3) {
        pitch = 1.25;
        roll = 0.05 + 0.18 * (0.5 + 0.5 * Math.sin(t / 55));
      } else if (f.style === 3 && f.scarf) {
        pitch = 2.75;
        roll = 0.42 + 0.06 * Math.sin(t / 140);
      } else {
        pitch = 2.55 + 0.25 * Math.sin(t / 160);
        roll = 0.3 + 0.2 * Math.sin(t / 120);
      }
      const k = Math.min(1, e * 2.5);
      pitch = 0.55 + (pitch - 0.55) * k;
      roll = 0.08 + (roll - 0.08) * k;
    }
    const shoulder = z + 0.98;
    for (const s of [1, -1]) {
      this.r.makeRotationY(-pitch);
      m.makeRotationX(s * roll).premultiply(this.r).setPosition(x, f.y + s * 0.23, shoulder);
      this.arms.setMatrixAt(i * 2 + (s === 1 ? 0 : 1), m);
    }

    // The scarf: held up taut between the hands, or round the neck.
    if (!f.scarf) {
      m.makeScale(0, 0, 0);
    } else if (f.style === 3 && e > 0.3) {
      const reach = 0.56 * Math.cos(roll);
      const hx = x + reach * Math.sin(pitch);
      const hz = shoulder - reach * Math.cos(pitch);
      const span = 2 * (0.23 + 0.56 * Math.sin(roll));
      m.makeScale(0.05, span + 0.25, 0.2).setPosition(hx, f.y, hz - 0.08);
    } else {
      m.makeScale(0.1, 0.4, 0.09).setPosition(x + 0.07, f.y, z + 1.03);
    }
    this.scarves.setMatrixAt(i, m);
  }
}
