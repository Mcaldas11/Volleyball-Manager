/**
 * A final's trophy, and the confetti that comes down when it is lifted.
 *
 * The cup is turned on a lathe — a stepped foot, a slim stem, a deep bowl flaring to its lip — with
 * a handle either side to hold it up by, in polished gold that catches the hall's lights. The
 * confetti is a few hundred little strips of gold, silver, white and the winners' colours, falling
 * and fluttering over them, spinning as they come down and lying where they land; one instanced
 * mesh, every piece moved each frame.
 */

import {
  Color, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, LatheGeometry, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, Quaternion, TorusGeometry, Vector2, Vector3,
} from 'three';

/** The cup, about half a metre tall, its foot at the origin, standing up the z axis. */
export function buildTrophy(): Group {
  const gold = new MeshStandardMaterial({ color: '#f0bf4c', metalness: 1, roughness: 0.2, envMapIntensity: 1.4 });
  const profile = [
    [0, 0], [0.12, 0], [0.12, 0.035], [0.085, 0.055], [0.04, 0.085], [0.028, 0.2], [0.05, 0.235],
    [0.115, 0.3], [0.155, 0.4], [0.165, 0.49], [0.152, 0.5], [0.142, 0.41], [0.105, 0.315], [0, 0.3],
  ].map(([r, h]) => new Vector2(r, h));
  const cup = new Group();
  const body = new Mesh(new LatheGeometry(profile, 40).rotateX(Math.PI / 2), gold);
  body.castShadow = true;
  cup.add(body);
  // A handle either side: a half ring standing out from the bowl.
  for (const side of [-1, 1]) {
    const handle = new Mesh(new TorusGeometry(0.07, 0.013, 10, 24, Math.PI).rotateX(Math.PI / 2), gold);
    // Turned to stand out from the bowl, bulging away from it.
    handle.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    handle.position.set(side * 0.15, 0, 0.4);
    handle.castShadow = true;
    cup.add(handle);
  }
  return cup;
}

interface Piece {
  x: number;
  y: number;
  z: number;
  /** How fast it falls, and how wide and how fast it sways. */
  fall: number;
  sway: number;
  rate: number;
  phase: number;
  spin: number;
  /** Down on the floor. */
  down: boolean;
}

const PIECES = 700;

/** A number in [0, 1) fixed by two keys: each piece its own, every time. */
function rand(a: number, b: number): number {
  let h = (Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Confetti {
  readonly mesh: InstancedMesh;
  private readonly pieces: Piece[] = [];
  private t0 = -1;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly axis = new Vector3();
  private readonly at = new Vector3();
  private readonly size = new Vector3(1, 1, 1);
  private centre = { x: 0, y: 0 };

  constructor() {
    this.mesh = new InstancedMesh(
      new PlaneGeometry(0.07, 0.035),
      new MeshBasicMaterial({ side: DoubleSide, toneMapped: false }),
      PIECES,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Bring it down over (x, y): gold, silver, white and `colour`. */
  start(x: number, y: number, colour: string, now: number): void {
    if (this.t0 >= 0) return;
    this.t0 = now;
    this.centre = { x, y };
    const colours = ['#f2c14e', '#ffd978', '#e8edf3', '#ffffff', colour, colour];
    const c = new Color();
    for (let i = 0; i < PIECES; i++) {
      const p = this.spawn(i, 0);
      this.pieces.push(p);
      this.mesh.setColorAt(i, c.set(colours[i % colours.length]));
    }
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = true;
  }

  /** Piece `i`, the `round`th time it comes down — the first from all over the sky, later ones from the roof. */
  private spawn(i: number, round: number): Piece {
    const first = round === 0;
    const r = (k: number): number => rand(i * 131 + round, k);
    return {
      // Most over the winners, the rest across the court.
      x: this.centre.x + (r(1) - 0.5) * (r(7) < 0.7 ? 6 : 12),
      y: this.centre.y + (r(2) - 0.5) * (r(7) < 0.7 ? 7 : 18),
      z: first ? 5 + r(3) * 9 : 11 + r(3) * 3,
      fall: 0.55 + r(4) * 0.6,
      sway: 0.15 + r(5) * 0.35,
      rate: 1.5 + r(6) * 2.5,
      phase: r(8) * Math.PI * 2,
      spin: 3 + r(9) * 7,
      down: false,
    };
  }

  /** Every piece on by `dt` seconds. It keeps coming for a while, then what has fallen lies there. */
  update(now: number, dt: number): void {
    if (this.t0 < 0) return;
    const pouring = now - this.t0 < 9000;
    const t = (now - this.t0) / 1000;
    this.pieces.forEach((p, i) => {
      if (!p.down) {
        p.z -= p.fall * dt;
        if (p.z <= 0.01) {
          if (pouring && i % 3 !== 0) Object.assign(p, this.spawn(i, 1 + Math.floor(t * 7)));
          else {
            p.z = 0.005;
            p.down = true;
          }
        }
      }
      const sway = p.down ? 0 : p.sway;
      this.at.set(
        p.x + Math.sin(t * p.rate + p.phase) * sway,
        p.y + Math.cos(t * p.rate * 0.8 + p.phase) * sway * 0.7,
        p.z,
      );
      if (p.down) {
        this.q.setFromAxisAngle(this.axis.set(0, 0, 1), p.phase);
      } else {
        this.axis.set(Math.sin(p.phase), Math.cos(p.phase), 0.4).normalize();
        this.q.setFromAxisAngle(this.axis, t * p.spin + p.phase);
      }
      this.m.compose(this.at, this.q, this.size);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
