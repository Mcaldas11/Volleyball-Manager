/**
 * The live court's players, net and ball in 3D, drawn with WebGL over the
 * painted hall.
 *
 * The hall — floor, lines and boards — stays a painted canvas underneath,
 * the crowd standing in its stand in 3D (crowd3d.ts); this layer is transparent everywhere else and adds what moves
 * and stands up: every player as a jointed body in their side's kit (the
 * libero in theirs), numbered on the back, their role's colour across the
 * shoulders, built to their real height and posed each frame from the
 * skeleton courtMotion.ts works out; the net with its tapes, antennas and
 * posts; the ball, spinning as it was struck; and real shadows cast on to the
 * painted floor. The camera is the same pinhole the painted hall is projected
 * with (courtCamera.ts), so the two layers line up to the pixel — unless another
 * camera is chosen (courtCameras.ts), when the hall itself is built in 3D
 * (hall3d.ts) and the painted one is put away. On the bench
 * side: each team's bench along the boards, in its colours, with the water
 * bottles on the floor in front of it, and its coach. Round the court, the
 * ball kids, and the balls they keep going.
 */

import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BoxGeometry, CanvasTexture, CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, NeutralToneMapping, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry,
  PMREMGenerator, RepeatWrapping, RingGeometry, Scene, ShadowMaterial, SphereGeometry, SRGBColorSpace, Vector3,
  WebGLRenderer, type Material,
} from 'three';
import { fitCamera } from './courtCamera.ts';
import { Cameraman, lens, type CameraMode } from './courtCameras.ts';
import { Crowd } from './crowd3d.ts';
import { buildHall, liveHall, type Hall } from './hall3d.ts';
import { buildTrophy, Confetti } from './trophy3d.ts';
import { REFEREE_STAND, SIDELINE, TROPHY_HAND_AT, TROPHY_OFFICIAL_AT, type CourtMotion } from './courtMotion.ts';
import { COURT_HALF_WIDTH, NET_HEIGHT } from './matchCourt.ts';
import { Figure, type Kit, type Look } from './figure3d.ts';

export type { Kit, Look } from './figure3d.ts';

/** The first referee: light polo, dark collar and trousers, no number. */
const REFEREE_LOOK: Look = {
  kit: { shirt: '#eef1f5', shorts: '#1b2130', libero: '#eef1f5' },
  libero: false, trim: '#1b2130', number: 0, skin: '#d9a97c', hair: '#2b1d14', hairStyle: 0, trousers: true,
};

/** A line judge: dark polo, dark trousers, flag in hand. */
const LINE_JUDGE_LOOK: Look = {
  kit: { shirt: '#2a3448', shorts: '#151a24', libero: '#2a3448' },
  libero: false, trim: '#e8c547', number: 0, skin: '#c99a73', hair: '#1a1410', hairStyle: 1, trousers: true,
};

/** The federation's man who presents a trophy: a dark suit, a gold lanyard, grey at the temples. */
const OFFICIAL_LOOK: Look = {
  kit: { shirt: '#222a3a', shorts: '#171c27', libero: '#222a3a' },
  libero: false, trim: '#d8b04a', number: 0, skin: '#d2a07a', hair: '#8f8f8f', hairStyle: 1, trousers: true,
};

/** The physio: a white polo trimmed in red, dark trousers. */
const MEDIC_LOOK: Look = {
  kit: { shirt: '#f4f6f8', shorts: '#2a3140', libero: '#f4f6f8' },
  libero: false, trim: '#d63a3a', number: 0, skin: '#c99a73', hair: '#3a2a1e', hairStyle: 1, trousers: true,
};

/** The ball kids: a teal tracksuit, zipped, long trousers — each his own face and hair. */
const KID_LOOKS: readonly Look[] = (
  [['#eac29d', '#3a2a1c', 0], ['#c18a60', '#1a1410', 2], ['#f3d4b8', '#8a5a2b', 1], ['#99653f', '#1a1410', 0], ['#dcaa80', '#2b1d14', 1], ['#f3d4b8', '#c9a15a', 0]] as const
).map(([skin, hair, hairStyle]) => ({
  kit: { shirt: '#2f8f83', shorts: '#1d2633', libero: '#2f8f83' },
  libero: false, trim: '#f4f6f8', number: 0, skin, hair, hairStyle, trousers: true, longSleeves: true, front: { kind: 'zip' as const },
}));

/** A perspective camera that sees exactly what the painted hall's projector
 *  does for a `width` × `height` box. */
export function courtCamera(width: number, height: number, camera = new PerspectiveCamera()): PerspectiveCamera {
  // The line of sight meets the screen at (cx, cy), not the middle.
  lens(camera, fitCamera(width, height), width, height);
  return camera;
}

// ---- The net, posts and ball -------------------------------------------------------

const POST_X = COURT_HALF_WIDTH + 0.6;

function netTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(12, 16, 22, 0.22)';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(235, 240, 246, 0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 61, 61);
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  // A 10 cm mesh.
  tex.repeat.set((2 * COURT_HALF_WIDTH + 0.5) / 0.1, 1 / 0.1);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function buildNet(): Group {
  const net = new Group();
  const width = 2 * COURT_HALF_WIDTH + 0.5;
  const mesh = new Mesh(
    new PlaneGeometry(width, 1).rotateX(Math.PI / 2),
    new MeshBasicMaterial({ map: netTexture(), transparent: true, side: DoubleSide, depthWrite: false }),
  );
  mesh.position.z = NET_HEIGHT - 0.5;
  net.add(mesh);
  const tape = new MeshStandardMaterial({ color: '#f4f6fa', roughness: 0.6 });
  const top = new Mesh(new BoxGeometry(width, 0.012, 0.07), tape);
  top.position.z = NET_HEIGHT - 0.035;
  top.castShadow = true;
  net.add(top);
  const bottom = new Mesh(new BoxGeometry(width, 0.01, 0.05), tape);
  bottom.position.z = NET_HEIGHT - 1 + 0.025;
  net.add(bottom);
  const cable = new Mesh(new CylinderGeometry(0.006, 0.006, 2 * POST_X, 6).rotateZ(Math.PI / 2), tape);
  cable.position.z = NET_HEIGHT - 0.01;
  net.add(cable);
  // Antennas over each sideline, red and white.
  const red = new MeshStandardMaterial({ color: '#e5484d', roughness: 0.5 });
  const white = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 });
  const bit = new CylinderGeometry(0.01, 0.01, 0.2, 8).rotateX(Math.PI / 2);
  for (const x of [-COURT_HALF_WIDTH, COURT_HALF_WIDTH]) {
    for (let i = 0; i < 9; i++) {
      const m = new Mesh(bit, i % 2 === 0 ? red : white);
      m.position.set(x, 0, NET_HEIGHT - 1 + 0.1 + i * 0.2);
      net.add(m);
    }
  }
  // Posts, padded round the foot.
  const steel = new MeshStandardMaterial({ color: '#b8c2cf', roughness: 0.35, metalness: 0.6 });
  const padding = new MeshStandardMaterial({ color: '#1f5c9f', roughness: 0.8 });
  for (const x of [-POST_X, POST_X]) {
    const post = new Mesh(new CylinderGeometry(0.045, 0.045, NET_HEIGHT + 0.15, 12).rotateX(Math.PI / 2), steel);
    post.position.set(x, 0, (NET_HEIGHT + 0.15) / 2);
    post.castShadow = true;
    net.add(post);
    const pad = new Mesh(new CylinderGeometry(0.13, 0.13, 1.7, 16).rotateX(Math.PI / 2), padding);
    pad.position.set(x, 0, 0.85);
    pad.castShadow = true;
    net.add(pad);
  }
  return net;
}

/** A tube from `a` to `b`. */
function tube(a: [number, number, number], b: [number, number, number], r: number, m: Material): Mesh {
  const from = new Vector3(...a);
  const dir = new Vector3(...b).sub(from);
  const mesh = new Mesh(new CylinderGeometry(r, r, dir.length(), 8), m);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  return mesh;
}

/** The first referee's stand: a platform on four legs, padded on the court
 *  side, a ladder up the back and a rail round the top. */
function buildRefereeStand(): Group {
  const stand = new Group();
  const h = REFEREE_STAND.height;
  stand.position.set(REFEREE_STAND.x, REFEREE_STAND.y, 0);
  const steel = new MeshStandardMaterial({ color: '#b8c2cf', roughness: 0.35, metalness: 0.6 });
  const padding = new MeshStandardMaterial({ color: '#1f5c9f', roughness: 0.8 });
  const deck = new Mesh(new BoxGeometry(0.66, 0.66, 0.06), new MeshStandardMaterial({ color: '#2a3342', roughness: 0.6 }));
  deck.position.z = h - 0.03;
  deck.castShadow = true;
  stand.add(deck);
  const w = 0.29;
  for (const x of [-w, w]) {
    for (const y of [-w, w]) stand.add(tube([x, y, 0], [x, y, h - 0.06], 0.025, steel));
    // Braces across each side.
    stand.add(tube([x, -w, 0.45], [x, w, 0.45], 0.015, steel));
  }
  for (const y of [-w, w]) stand.add(tube([-w, y, 0.45], [w, y, 0.45], 0.015, steel));
  // Padding on the legs facing the court.
  for (const y of [-w, w]) {
    const pad = new Mesh(new CylinderGeometry(0.06, 0.06, 1.0, 12).rotateX(Math.PI / 2), padding);
    pad.position.set(w, y, 0.5);
    pad.castShadow = true;
    stand.add(pad);
  }
  // The ladder up the back, away from the court.
  const lx = -w - 0.08;
  for (const y of [-0.17, 0.17]) stand.add(tube([lx - 0.25, y, 0], [lx, y, h + 0.9], 0.018, steel));
  for (let z = 0.3; z < h; z += 0.3) {
    const x = lx - 0.25 + (0.25 * z) / (h + 0.9);
    stand.add(tube([x, -0.17, z], [x, 0.17, z], 0.014, steel));
  }
  // A rail round the top at waist height.
  const top = h + 0.95;
  for (const x of [-w, w]) for (const y of [-w, w]) stand.add(tube([x, y, h], [x, y, top], 0.016, steel));
  stand.add(tube([w, -w, top], [w, w, top], 0.02, steel));
  for (const y of [-w, w]) stand.add(tube([-w, y, top], [w, y, top], 0.02, steel));
  return stand;
}

/**
 * A team's bench by the boards: a padded bench in its colours, towels over
 * it, and the water bottles lined up on the floor in front — `side` the half
 * it is on.
 */
function buildBench(kit: Kit, side: number): Group {
  const g = new Group();
  const b = SIDELINE.bench;
  const length = b.y1 - b.y0;
  const mid = side * (b.y0 + length / 2);
  const steel = new MeshStandardMaterial({ color: '#9aa4b2', roughness: 0.4, metalness: 0.55 });
  const seat = new Mesh(new BoxGeometry(0.42, length, 0.09), new MeshStandardMaterial({ color: kit.shirt, roughness: 0.55 }));
  seat.position.set(b.x, mid, 0.46);
  seat.castShadow = true;
  seat.receiveShadow = true;
  g.add(seat);
  for (const dy of [-length / 2 + 0.25, 0, length / 2 - 0.25]) {
    for (const dx of [-0.16, 0.16]) g.add(tube([b.x + dx, mid + dy, 0], [b.x + dx, mid + dy, 0.42], 0.02, steel));
  }
  // Towels thrown over it.
  const towel = new MeshStandardMaterial({ color: '#f1f3f6', roughness: 0.95 });
  for (const at of [0.18, 0.47, 0.8]) {
    const t = new Mesh(new BoxGeometry(0.46, 0.34, 0.025), towel);
    t.position.set(b.x, side * (b.y0 + length * at), 0.52);
    t.rotation.z = (at - 0.5) * 0.4;
    t.castShadow = true;
    g.add(t);
  }
  // The bottles: clear blue, a cap in the team's colour, a crate at the end.
  const bottle = new CylinderGeometry(0.037, 0.04, 0.24, 14).rotateX(Math.PI / 2);
  const cap = new CylinderGeometry(0.022, 0.022, 0.04, 10).rotateX(Math.PI / 2);
  const plastic = new MeshStandardMaterial({ color: '#7fb6e8', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.85 });
  const capMat = new MeshStandardMaterial({ color: kit.shirt, roughness: 0.5 });
  for (let i = 0; i < 7; i++) {
    const y = side * (b.y0 + 0.3 + i * 0.42);
    const x = b.x + 0.42 + (i % 2) * 0.07;
    const body = new Mesh(bottle, plastic);
    body.position.set(x, y, 0.12);
    body.castShadow = true;
    const top = new Mesh(cap, capMat);
    top.position.set(x, y, 0.26);
    g.add(body, top);
  }
  const crate = new Mesh(new BoxGeometry(0.36, 0.5, 0.26), new MeshStandardMaterial({ color: '#2a3342', roughness: 0.7 }));
  crate.position.set(b.x + 0.05, side * (b.y1 + 0.45), 0.13);
  crate.castShadow = true;
  g.add(crate);
  return g;
}

/** A volleyball's panels: three bands of curved stripes, blue and yellow on white. */
function ballTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f6f3e6';
  ctx.fillRect(0, 0, 256, 128);
  const band = (y: number, colour: string, phase: number): void => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 4) ctx.lineTo(x, y + 9 * Math.sin((x / 256) * Math.PI * 4 + phase));
    for (let x = 256; x >= 0; x -= 4) ctx.lineTo(x, y + 20 + 9 * Math.sin((x / 256) * Math.PI * 4 + phase));
    ctx.closePath();
    ctx.fill();
  };
  band(16, '#2f5fd0', 0);
  band(54, '#f5c518', 1.6);
  band(92, '#2f5fd0', 3.2);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

// ---- The layer -------------------------------------------------------------------------

export class Court3D {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera();
  private readonly figures = new Map<number, Figure>();
  private readonly referee = new Figure(REFEREE_LOOK);
  /** The two line judges, flags in hand. */
  private readonly lineJudges: [Figure, Figure] = [new Figure(LINE_JUDGE_LOOK), new Figure(LINE_JUDGE_LOOK)];
  /** Each side's coach, made the first time the court is drawn. */
  private coaches: [Figure, Figure] | null = null;
  /** The physio, made the first time one is on. */
  private medic: Figure | null = null;
  /** The benches, rebuilt when the kits or the halves change. */
  private benches: Group | null = null;
  private benchKey = '';
  /** The people in the stand, made the first time the court is drawn. */
  private crowd: Crowd | null = null;
  private fill = 0.85;
  private kits: [Kit, Kit] | null = null;
  /** Who aims the camera, and through which of them the match is watched. */
  private readonly cameraman = new Cameraman();
  /** The hall in 3D, built the first time a camera other than the broadcast is chosen. */
  private hall: Hall | null = null;
  /** A final's cup and its confetti, made when the trophy is lifted. */
  private cup: Group | null = null;
  private confetti: Confetti | null = null;
  /** The federation's man who brings it out. */
  private official: Figure | null = null;
  private readonly handA = new Vector3();
  private readonly handB = new Vector3();
  private readonly ball: Mesh;
  /** The ball kids, and the other balls — in their hands, rolling between them, on the floor — by ball. */
  private readonly kids: Figure[] = [];
  private readonly spares = new Map<number, Mesh>();
  private readonly trail: Mesh[] = [];
  private readonly actorRing: Mesh;
  private readonly landing: Mesh;
  private width = 1;
  private height = 1;
  private readonly spinAxis = new Vector3();
  private readonly tmp = new Vector3();

  /** Throws if the browser can't give us WebGL. */
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.outputColorSpace = SRGBColorSpace;
    // Film-like highlights that keep the kits' colours true.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // The hall itself lights everything softly from every side — and shines in skin and cloth.
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    // The room is built y-up; the court is z-up.
    this.scene.environmentRotation.set(Math.PI / 2, 0, 0);
    this.scene.environmentIntensity = 0.45;

    // Arena lighting: bright from above, a warm bounce off the court.
    const sky = new HemisphereLight('#e8eeff', '#9a6a4c', 0.8);
    sky.position.set(0, 0, 1);
    this.scene.add(sky);
    // The far side's lights, behind the players as the camera sees them: a cool edge round each one.
    const rim = new DirectionalLight('#d8e6ff', 1.25);
    rim.position.set(-12, 4, 9);
    this.scene.add(rim);
    const key = new DirectionalLight('#ffffff', 2.0);
    key.position.set(3.5, -2.5, 16);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const cam = key.shadow.camera;
    cam.left = -9;
    cam.right = 9;
    cam.top = 14;
    cam.bottom = -14;
    cam.near = 4;
    cam.far = 30;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3;
    this.scene.add(key, key.target);
    const fill = new DirectionalLight('#dfe6f5', 0.4);
    fill.position.set(14, -3, 6);
    this.scene.add(fill);

    // Shadows only: the painted floor shows through everywhere else.
    const floor = new Mesh(new PlaneGeometry(40, 40), new ShadowMaterial({ opacity: 0.34 }));
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.scene.add(buildNet());
    this.scene.add(buildRefereeStand());
    this.scene.add(this.referee.root);
    for (const j of this.lineJudges) {
      j.holdFlag();
      this.scene.add(j.root);
    }

    this.ball = new Mesh(
      new SphereGeometry(0.13, 28, 18),
      new MeshStandardMaterial({ map: ballTexture(), roughness: 0.5 }),
    );
    this.ball.castShadow = true;
    this.ball.visible = false;
    this.scene.add(this.ball);
    const streak = new SphereGeometry(0.1, 10, 8);
    for (let i = 0; i < 7; i++) {
      const m = new Mesh(streak, new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      this.trail.push(m);
      this.scene.add(m);
    }

    const ringMat = (colour: string): MeshBasicMaterial =>
      new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, depthWrite: false });
    this.actorRing = new Mesh(new RingGeometry(0.5, 0.58, 48), ringMat('#ffc72c'));
    this.actorRing.position.z = 0.012;
    this.actorRing.visible = false;
    this.scene.add(this.actorRing);
    this.landing = new Mesh(new RingGeometry(0.86, 1, 40), ringMat('#ffffff'));
    this.landing.position.z = 0.012;
    this.landing.visible = false;
    this.scene.add(this.landing);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    // Past one and a half pixels per CSS pixel the court looks no sharper,
    // and every frame costs half as much again — or more.
    this.renderer.setPixelRatio(Math.min(dpr, 1.5));
    this.renderer.setSize(width, height, false);
    courtCamera(width, height, this.camera);
    // Whichever camera is chosen, aimed again for the new box on the next frame.
    this.cameraman.invalidate();
  }

  /** The crowd in the stand, `fill` full, in these sides' colours. */
  setCrowd(kits: [Kit, Kit], fill: number): void {
    if (this.crowd === null) {
      this.crowd = new Crowd(fill);
      this.scene.add(this.crowd.group);
      this.fill = fill;
    }
    this.kits = kits;
    this.crowd.setKits(kits);
  }

  /** Watch through this camera. Any but the broadcast brings the hall up in 3D. */
  setCamera(mode: CameraMode): void {
    if (mode === this.cameraman.current) return;
    this.cameraman.setMode(mode);
    if (mode !== 'broadcast' && this.hall === null) {
      this.hall = buildHall(this.fill, this.renderer.capabilities.getMaxAnisotropy());
      this.scene.add(this.hall.group);
    }
    if (this.hall !== null) this.hall.group.visible = mode !== 'broadcast';
  }

  /** The benches for these kits, the near team (`sides[t]` the half team `t` is on) on its own. */
  setBenches(kits: [Kit, Kit], sides: [number, number]): void {
    const key = JSON.stringify([kits, sides]);
    if (key === this.benchKey) return;
    this.benchKey = key;
    if (this.benches !== null) {
      this.scene.remove(this.benches);
      this.benches.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.geometry.dispose();
        (o.material as Material).dispose();
      });
    }
    this.benches = new Group();
    this.benches.add(buildBench(kits[0], sides[0]), buildBench(kits[1], sides[1]));
    this.scene.add(this.benches);
  }

  /** Draw the court at `now`; `look` says how each player looks — and, for
   *  `coachLook(t)`, each side's coach. */
  render(motion: CourtMotion, now: number, dt: number, look: (p: number) => Look, coachLook?: (t: 0 | 1) => Look): void {
    if (coachLook !== undefined) {
      if (this.coaches === null) {
        this.coaches = [new Figure(coachLook(0)), new Figure(coachLook(1))];
        for (const f of this.coaches) this.scene.add(f.root);
      }
      this.coaches.forEach((f, t) => {
        f.restyle(coachLook(t as 0 | 1));
        f.pose(motion.coaches[t]);
      });
    }
    if (motion.medic !== null) {
      if (this.medic === null) {
        this.medic = new Figure(MEDIC_LOOK);
        this.scene.add(this.medic.root);
      }
      this.medic.root.visible = true;
      this.medic.pose(motion.medic);
    } else if (this.medic !== null) {
      this.medic.root.visible = false;
    }
    for (const [p, b] of motion.bodies) {
      let f = this.figures.get(p);
      if (f === undefined) {
        f = new Figure(look(p));
        this.figures.set(p, f);
        this.scene.add(f.root);
      } else {
        f.restyle(look(p));
      }
      f.pose(b);
    }
    for (const [p, f] of this.figures) {
      if (motion.bodies.has(p)) continue;
      this.scene.remove(f.root);
      f.dispose();
      this.figures.delete(p);
    }

    // The ball, spinning about the axis across its flight.
    const ball = motion.ballAt(now);
    this.ball.visible = ball !== null;
    const flight = motion.flight;
    if (ball !== null) {
      this.ball.position.set(ball.x, ball.y, Math.max(0.13, ball.z));
      if (flight !== null && now >= flight.t0 && now < flight.t0 + flight.ms) {
        const dx = flight.to.x - flight.from.x;
        const dy = flight.to.y - flight.from.y;
        const l = Math.hypot(dx, dy);
        if (l > 1e-3) {
          this.spinAxis.set(-dy / l, dx / l, 0);
          this.ball.rotateOnWorldAxis(this.spinAxis, flight.spin * dt);
        }
      }
    }
    // The ball kids, and every other ball: turning over as it rolls along the floor.
    motion.ballKids.forEach((b, i) => {
      let f = this.kids[i];
      if (f === undefined) {
        f = new Figure(KID_LOOKS[i % KID_LOOKS.length]);
        this.kids.push(f);
        this.scene.add(f.root);
      }
      f.pose(b);
    });
    const shown = new Set<number>();
    for (const s of motion.spareBalls(now)) {
      shown.add(s.id);
      let m = this.spares.get(s.id);
      if (m === undefined) {
        m = new Mesh(this.ball.geometry, this.ball.material);
        m.castShadow = true;
        m.position.set(s.x, s.y, Math.max(0.13, s.z));
        this.spares.set(s.id, m);
        this.scene.add(m);
      }
      const dx = s.x - m.position.x;
      const dy = s.y - m.position.y;
      const d = Math.hypot(dx, dy);
      if (s.z < 0.2 && d > 1e-4) {
        this.spinAxis.set(-dy / d, dx / d, 0);
        m.rotateOnWorldAxis(this.spinAxis, d / 0.13);
      }
      m.position.set(s.x, s.y, Math.max(0.13, s.z));
    }
    for (const [id, m] of this.spares) {
      if (shown.has(id)) continue;
      this.scene.remove(m);
      this.spares.delete(id);
    }

    // A streak behind a hard-hit ball — down off a block as much as across the court.
    const fast = flight !== null && flight.ms > 0 && now >= flight.t0 && now < flight.t0 + flight.ms
      && Math.hypot(flight.to.x - flight.from.x, flight.to.y - flight.from.y, flight.to.z - flight.from.z) / flight.ms > 0.012;
    this.trail.forEach((m, i) => {
      const t = motion.trail[i];
      m.visible = fast && t !== undefined;
      if (t === undefined) return;
      m.position.set(t.x, t.y, t.z);
      const k = (i + 1) / motion.trail.length;
      m.scale.setScalar(0.4 + 0.6 * k);
      (m.material as MeshBasicMaterial).opacity = 0.05 + 0.2 * k;
    });

    // Who is on the ball, and where it will come down.
    const actor = motion.actor !== null ? motion.bodies.get(motion.actor) : undefined;
    this.actorRing.visible = actor !== undefined;
    if (actor !== undefined) this.actorRing.position.set(actor.x, actor.y, 0.012);
    const landing = flight !== null && flight.to.z < 1.3 && now < flight.t0 + flight.ms;
    this.landing.visible = landing;
    if (landing && flight !== null) {
      this.landing.position.set(flight.to.x, flight.to.y, 0.012);
      this.landing.scale.setScalar(0.35 + 0.15 * Math.sin(now / 90));
    }

    this.referee.pose(motion.referee);
    this.lineJudges.forEach((j, i) => j.pose(motion.lineJudges[i]));
    if (this.crowd !== null) {
      this.crowd.react(motion.cheer);
      this.crowd.update(now);
    }
    if (this.hall !== null && this.hall.group.visible && this.kits !== null) liveHall(this.hall, this.kits, motion.cheer, now);
    this.renderTrophy(motion, now, dt);

    this.cameraman.aim(this.camera, motion, now, dt, this.width, this.height);
    this.renderer.render(this.scene, this.camera);
  }

  /** Where a player's head is on screen, CSS px — for the labels over them. */
  headOnScreen(p: number): { X: number; Y: number; s: number } | null {
    const f = this.figures.get(p);
    return f === undefined ? null : this.onScreen(f);
  }

  /** A final won: the cup in the captain's hands — handed to him once they have gathered — and the confetti once it goes up. */
  private renderTrophy(motion: CourtMotion, now: number, dt: number): void {
    const t = motion.trophy;
    if (t === null) return;
    if (this.cup === null) {
      this.cup = buildTrophy();
      this.scene.add(this.cup);
      this.confetti = new Confetti();
      this.scene.add(this.confetti.mesh);
    }
    const since = now - t.t0;
    // The federation's man, walking out with it.
    if (motion.official !== null) {
      if (this.official === null) {
        this.official = new Figure(OFFICIAL_LOOK);
        this.scene.add(this.official.root);
      }
      this.official.pose(motion.official);
    }
    // In his hands until it is handed over; the captain's after.
    const holder = since < TROPHY_HAND_AT ? this.official ?? undefined : t.captain !== null ? this.figures.get(t.captain) : undefined;
    this.cup.visible = holder !== undefined && since >= TROPHY_OFFICIAL_AT;
    if (holder !== undefined && this.cup.visible) {
      // Held by its handles, upright, turned with his hands.
      holder.handsAt(this.handA, this.handB);
      this.cup.position.set((this.handA.x + this.handB.x) / 2, (this.handA.y + this.handB.y) / 2, (this.handA.z + this.handB.z) / 2 - 0.4);
      this.cup.rotation.set(0, 0, Math.atan2(this.handB.y - this.handA.y, this.handB.x - this.handA.x));
      this.cup.scale.setScalar(Math.min(1, (since - TROPHY_OFFICIAL_AT) / 400));
    }
    if (this.confetti !== null) {
      if (since >= t.lift) this.confetti.start(t.at.x, t.at.y, this.kits?.[t.team].shirt ?? '#f2c14e', now);
      this.confetti.update(now, dt);
    }
  }

  /** Where a spot on the floor is on screen, CSS px — for the video's close-up of it. */
  groundOnScreen(x: number, y: number): { X: number; Y: number } {
    this.tmp.set(x, y, 0).project(this.camera);
    return { X: ((this.tmp.x + 1) / 2) * this.width, Y: ((1 - this.tmp.y) / 2) * this.height };
  }

  /** Where the referee's head is on screen, for their call over it. */
  refereeOnScreen(): { X: number; Y: number; s: number } {
    return this.onScreen(this.referee);
  }

  private onScreen(f: Figure): { X: number; Y: number; s: number } {
    f.head.getWorldPosition(this.tmp);
    this.tmp.z += 0.12;
    const d = this.tmp.distanceTo(this.camera.position);
    this.tmp.project(this.camera);
    const focal = this.height / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    return { X: ((this.tmp.x + 1) / 2) * this.width, Y: ((1 - this.tmp.y) / 2) * this.height, s: focal / d };
  }

  dispose(): void {
    for (const f of this.figures.values()) f.dispose();
    this.referee.dispose();
    this.official?.dispose();
    for (const f of this.kids) f.dispose();
    for (const f of this.coaches ?? []) f.dispose();
    this.figures.clear();
    this.scene.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      o.geometry.dispose();
      const m = o.material as MeshBasicMaterial | MeshStandardMaterial;
      m.map?.dispose();
      m.dispose();
    });
    this.renderer.dispose();
    // Browsers keep only a handful of WebGL contexts alive; give this one back now.
    this.renderer.forceContextLoss();
  }
}
