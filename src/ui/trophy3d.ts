/**
 * A final's trophy, and the confetti that comes down when it is lifted.
 *
 * The trophy stands on a black lacquered plinth, eight-sided, banded in gold with a plate on its
 * faces. Above it, all in polished gold turned on a lathe: a stepped foot, a stem with a ring round
 * it, a deep bowl with a wall to it, flaring to a rolled lip, two engraved bands round it, and a
 * domed lid; on the lid a spire holding up a volleyball, silver and gold. A handle either side to
 * hold it up by, sweeping out from the foot of the bowl and up to its rim, curled over at the top.
 * The confetti is a few hundred little strips of gold, silver, white and the winners' colours,
 * falling and fluttering over them, spinning as they come down and lying where they land; one
 * instanced mesh, every piece moved each frame.
 */

import {
  BoxGeometry, CanvasTexture, CatmullRomCurve3, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, Group, InstancedMesh,
  LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, PlaneGeometry, Quaternion, SphereGeometry,
  SRGBColorSpace, TorusGeometry, TubeGeometry, Vector2, Vector3, type BufferGeometry, type Material,
} from 'three';

/** A shape turned on the lathe round the z axis, from (radius, height) points. */
function turned(points: ReadonlyArray<readonly [number, number]>, segments = 56): BufferGeometry {
  return new LatheGeometry(points.map(([r, h]) => new Vector2(r, h)), segments).rotateX(Math.PI / 2);
}

/** A trophy ball's panels: silver, the seams and one band in gold. */
function ballPanels(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e4e8ee';
  ctx.fillRect(0, 0, 256, 128);
  const band = (y: number, fill: string, phase: number): void => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 4) ctx.lineTo(x, y + 9 * Math.sin((x / 256) * Math.PI * 4 + phase));
    for (let x = 256; x >= 0; x -= 4) ctx.lineTo(x, y + 20 + 9 * Math.sin((x / 256) * Math.PI * 4 + phase));
    ctx.closePath();
    ctx.fill();
  };
  band(16, '#c5ccd6', 0);
  band(54, '#e8bd55', 1.6);
  band(92, '#c5ccd6', 3.2);
  ctx.strokeStyle = 'rgba(70, 60, 30, 0.55)';
  ctx.lineWidth = 2;
  for (const [y, ph] of [[16, 0], [36, 0], [54, 1.6], [74, 1.6], [92, 3.2], [112, 3.2]] as const) {
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 4) ctx.lineTo(x, y + 9 * Math.sin((x / 256) * Math.PI * 4 + ph));
    ctx.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** The trophy, about 0.77 m tall, its plinth's foot at the origin, standing up the z axis; its handles at ±x. */
export function buildTrophy(): Group {
  const gold = new MeshPhysicalMaterial({
    color: '#efc04e', metalness: 1, roughness: 0.14, clearcoat: 0.5, clearcoatRoughness: 0.12, envMapIntensity: 1.6,
  });
  // Engraved bands and the inside of the bowl: the same gold, duller.
  const satin = new MeshPhysicalMaterial({ color: '#c99a36', metalness: 1, roughness: 0.38, envMapIntensity: 1.2 });
  const lacquer = new MeshPhysicalMaterial({ color: '#0c0e12', metalness: 0.2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
  const silver = new MeshPhysicalMaterial({ map: ballPanels(), metalness: 0.65, roughness: 0.22, clearcoat: 0.6 });
  const cup = new Group();
  const put = (g: BufferGeometry, m: Material, z = 0): Mesh => {
    const mesh = new Mesh(g, m);
    mesh.position.z = z;
    mesh.castShadow = true;
    cup.add(mesh);
    return mesh;
  };

  // The plinth: two tiers, eight-sided, a gold band between them and a plate on the front and back.
  const tier = (rTop: number, rBottom: number, h: number): BufferGeometry =>
    new CylinderGeometry(rTop, rBottom, h, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8);
  put(tier(0.108, 0.118, 0.046), lacquer, 0.023);
  put(tier(0.112, 0.112, 0.006), gold, 0.049);
  put(tier(0.092, 0.1, 0.026), lacquer, 0.065);
  for (const side of [-1, 1]) put(new BoxGeometry(0.074, 0.003, 0.026), gold, 0.024).position.y = side * 0.106;

  // Foot, stem and bowl in one: the outside up to the lip, then the inside back down.
  put(turned([
    [0, 0.078], [0.088, 0.078], [0.088, 0.086], [0.078, 0.094], [0.074, 0.104], [0.052, 0.114], [0.034, 0.128], [0.025, 0.152],
    [0.023, 0.178], [0.036, 0.19], [0.042, 0.197], [0.036, 0.205], [0.023, 0.216], [0.025, 0.24], [0.05, 0.262], [0.1, 0.3],
    [0.14, 0.35], [0.16, 0.41], [0.168, 0.47], [0.17, 0.53], [0.172, 0.556],
    [0.163, 0.556], [0.161, 0.5], [0.153, 0.43], [0.131, 0.362], [0.092, 0.313], [0, 0.295],
  ]), gold);
  // The rolled lip, and two engraved bands round the bowl.
  put(new TorusGeometry(0.168, 0.0075, 12, 64), gold, 0.557);
  put(new TorusGeometry(0.169, 0.0032, 8, 64), satin, 0.472);
  put(new TorusGeometry(0.126, 0.0032, 8, 64), satin, 0.333);
  // The lid, domed; a spire on it holding up the ball.
  put(turned([
    [0.168, 0.56], [0.164, 0.574], [0.14, 0.594], [0.1, 0.607], [0.05, 0.613], [0.026, 0.618], [0.017, 0.63], [0.022, 0.645],
    [0.013, 0.66], [0.011, 0.69], [0, 0.692],
  ]), gold);
  put(new TorusGeometry(0.1, 0.004, 8, 56), satin, 0.607);
  const ball = put(new SphereGeometry(0.05, 32, 22), silver, 0.738);
  ball.rotation.set(0.5, 0.3, 0);

  // The handles: out from the foot of the bowl, round and up to its rim, curled over at the top.
  for (const side of [-1, 1]) {
    const path = new CatmullRomCurve3([
      [0.112, 0.3], [0.17, 0.302], [0.218, 0.33], [0.238, 0.4], [0.226, 0.47], [0.196, 0.515], [0.168, 0.53],
    ].map(([x, z]) => new Vector3(side * x, 0, z)));
    put(new TubeGeometry(path, 48, 0.0115, 10, false), gold);
    // The curl, and a boss where each end meets the bowl.
    const curl = new TorusGeometry(0.02, 0.008, 8, 24, Math.PI * 1.5).rotateX(Math.PI / 2);
    put(curl, gold, 0.548).position.x = side * 0.205;
    put(new SphereGeometry(0.014, 14, 10), gold, 0.3).position.x = side * 0.112;
    put(new SphereGeometry(0.013, 14, 10), gold, 0.53).position.x = side * 0.168;
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
