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
 * with (courtCamera.ts), so the two layers line up to the pixel. On the bench
 * side: each team's bench along the boards, in its colours, with the water
 * bottles on the floor in front of it, and its coach.
 */

import {
  BoxGeometry, BufferGeometry, CanvasTexture, CapsuleGeometry, Color, CylinderGeometry, DirectionalLight,
  DoubleSide, Group, HemisphereLight, LatheGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, RepeatWrapping, RingGeometry, Scene, ShadowMaterial,
  SphereGeometry, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Material,
} from 'three';
import { fitCamera } from './courtCamera.ts';
import { Crowd } from './crowd3d.ts';
import { REFEREE_STAND, SIDELINE, type Body, type CourtMotion } from './courtMotion.ts';
import { COURT_HALF_WIDTH, NET_HEIGHT } from './matchCourt.ts';
import { BONES } from './playerRig.ts';

/** A side's playing colours. */
export interface Kit {
  shirt: string;
  shorts: string;
  /** Liberos wear a contrasting shirt, as the rules require. */
  libero: string;
}

/** How one player looks. */
export interface Look {
  kit: Kit;
  libero: boolean;
  /** Colour across the shoulders that tells the role at a glance. */
  trim: string;
  number: number;
  skin: string;
  hair: string;
  /** 0 cropped, 1 short, 2 shaved. */
  hairStyle: number;
  /** Long trousers and dark shoes, for the referee. */
  trousers?: boolean;
}

/** The first referee: light polo, dark collar and trousers, no number. */
const REFEREE_LOOK: Look = {
  kit: { shirt: '#eef1f5', shorts: '#1b2130', libero: '#eef1f5' },
  libero: false, trim: '#1b2130', number: 0, skin: '#d9a97c', hair: '#2b1d14', hairStyle: 0, trousers: true,
};

/** A perspective camera that sees exactly what the painted hall's projector
 *  does for a `width` × `height` box. */
export function courtCamera(width: number, height: number, camera = new PerspectiveCamera()): PerspectiveCamera {
  const fit = fitCamera(width, height);
  camera.fov = (2 * Math.atan(height / 2 / fit.focal) * 180) / Math.PI;
  camera.aspect = width / height;
  camera.near = 0.5;
  camera.far = 150;
  camera.up.set(0, 0, 1);
  camera.position.set(fit.position.x, fit.position.y, fit.position.z);
  camera.lookAt(fit.target.x, fit.target.y, fit.target.z);
  // The line of sight meets the screen at (cx, cy), not the middle.
  camera.setViewOffset(width, height, width / 2 - fit.cx, height / 2 - fit.cy, width, height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

// ---- Shared shapes -----------------------------------------------------------------

/** A limb from its joint (z = 0) down to z = -length, rounded at both ends and
 *  tapering from radius `r0` to `r1`. */
function limb(r0: number, r1: number, length: number, mid?: number): BufferGeometry {
  const pts: Vector2[] = [];
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    pts.push(new Vector2(r1 * Math.cos(a), -length + r1 * Math.sin(a)));
  }
  if (mid !== undefined) pts.push(new Vector2(mid, -length * 0.55));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new Vector2(r0 * Math.cos(a), r0 * Math.sin(a)));
  }
  const g = new LatheGeometry(pts, 12);
  g.rotateX(Math.PI / 2);
  return g;
}

/** A body of revolution through (radius, height) points, flattened front to back. */
function trunk(profile: Array<[number, number]>, depth: number): BufferGeometry {
  const g = new LatheGeometry(profile.map(([r, z]) => new Vector2(r, z)), 24);
  g.rotateX(Math.PI / 2);
  g.scale(1, depth, 1);
  return g;
}

let shared: ReturnType<typeof buildShapes> | null = null;

function buildShapes() {
  const head = new SphereGeometry(0.105, 18, 14);
  head.scale(0.9, 1, 1.1);
  const hair = (cover: number): BufferGeometry => {
    const g = new SphereGeometry(0.112, 18, 10, 0, Math.PI * 2, 0, Math.PI * cover);
    g.rotateX(Math.PI / 2);
    g.rotateX(0.45);
    g.scale(0.92, 1.02, 1.1);
    return g;
  };
  const shoe = new CapsuleGeometry(0.045, 0.19, 4, 10);
  shoe.scale(1.15, 1, 0.85);
  const hand = new SphereGeometry(0.045, 10, 8);
  hand.scale(0.78, 0.5, 1.25);
  return {
    torso: trunk([
      [0, -0.13], [0.15, -0.12], [0.152, 0.02], [0.163, 0.18], [0.185, 0.34], [0.192, 0.44], [0.172, 0.53],
      [0.1, 0.585], [0.06, 0.6],
    ], 0.62),
    shorts: trunk([[0, -0.15], [0.15, -0.14], [0.176, -0.04], [0.168, 0.08], [0.153, 0.15], [0, 0.16]], 0.7),
    shortsLeg: limb(0.098, 0.09, 0.2),
    thigh: limb(0.084, 0.058, BONES.thigh),
    shin: limb(0.058, 0.041, BONES.shin, 0.064),
    pad: new CylinderGeometry(0.068, 0.066, 0.13, 14).rotateX(Math.PI / 2),
    sock: limb(0.05, 0.046, 0.15),
    shoe,
    sleeve: limb(0.07, 0.063, 0.12),
    upperArm: limb(0.053, 0.042, BONES.upperArm),
    forearm: limb(0.043, 0.033, BONES.forearm),
    hand,
    neck: new CylinderGeometry(0.052, 0.058, 0.13, 12).rotateX(Math.PI / 2),
    head,
    eye: new SphereGeometry(0.012, 6, 5),
    hair: [hair(0.52), hair(0.45), hair(0.38)],
  };
}

// ---- A player ------------------------------------------------------------------------

/** The shirt, as a texture wrapped round the torso: the number big on the
 *  back and small on the front, the role's colour across the shoulders. */
function shirtTexture(look: Look): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const colour = look.libero ? look.kit.libero : look.kit.shirt;
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 256, 256);
  // Across the top, the yoke over the shoulders, in the role's colour.
  ctx.fillStyle = look.trim;
  ctx.fillRect(0, 0, 256, 60);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.fillRect(0, 60, 256, 5);
  const light = new Color(colour).getHSL({ h: 0, s: 0, l: 0 }).l > 0.62;
  ctx.fillStyle = light ? '#10151d' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 80px "Segoe UI", system-ui, sans-serif';
  if (look.number > 0) {
    // The back is where the wrap starts and ends, so it is drawn at both edges.
    for (const x of [0, 256]) ctx.fillText(String(look.number), x, 128);
    ctx.font = '800 36px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(String(look.number), 128, 100);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

class Figure {
  readonly root = new Group();
  private readonly pelvis = new Group();
  private readonly spine = new Group();
  readonly head = new Group();
  private readonly shoulders: [Group, Group] = [new Group(), new Group()];
  private readonly elbows: [Group, Group] = [new Group(), new Group()];
  private readonly hips: [Group, Group] = [new Group(), new Group()];
  private readonly knees: [Group, Group] = [new Group(), new Group()];
  private readonly ankles: [Group, Group] = [new Group(), new Group()];
  private readonly shirt: MeshStandardMaterial;
  private readonly shorts: MeshStandardMaterial;
  private readonly materials: MeshStandardMaterial[];
  private alpha = 1;
  private kitKey: string;

  constructor(private look: Look) {
    const g = shared ?? (shared = buildShapes());
    const mat = (color: string, roughness = 0.72): MeshStandardMaterial =>
      new MeshStandardMaterial({ color: new Color(color), roughness, metalness: 0 });
    this.shirt = new MeshStandardMaterial({ map: shirtTexture(look), roughness: 0.68, metalness: 0 });
    this.shorts = mat(look.kit.shorts, 0.7);
    const skin = mat(look.skin, 0.6);
    const hair = mat(look.hair, 0.85);
    const pad = mat(look.number % 2 === 0 ? '#1b1f27' : '#e9ecf1', 0.8);
    const sock = mat('#f2f4f7', 0.8);
    const shoe = mat(look.trousers === true ? '#15181e' : '#f5f6f8', 0.45);
    // Bare legs, or trousers down to the shoes.
    const legs = look.trousers === true ? this.shorts : skin;
    const eye = mat('#1a1410', 0.4);
    this.materials = [this.shirt, this.shorts, skin, hair, pad, sock, shoe, eye];
    this.kitKey = JSON.stringify(look.kit);

    const part = (geo: BufferGeometry, m: Material, parent: Group, x = 0, y = 0, z = 0): Mesh => {
      const mesh = new Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    this.root.add(this.pelvis);
    part(g.shorts, this.shorts, this.pelvis, 0, 0, 0.03);
    this.pelvis.add(this.spine);
    this.spine.position.z = BONES.spine;
    part(g.torso, this.shirt, this.spine);
    part(g.neck, skin, this.spine, 0, 0.005, BONES.neck - 0.05);
    this.spine.add(this.head);
    this.head.position.z = BONES.neck;
    part(g.head, skin, this.head, 0, 0.005, BONES.head);
    if (look.hairStyle !== 2) part(g.hair[look.hairStyle], hair, this.head, 0, -0.008, BONES.head + 0.004);
    for (const side of [-1, 1]) part(g.eye, eye, this.head, side * 0.034, 0.096, BONES.head + 0.018);

    ([-1, 1] as const).forEach((side, i) => {
      const shoulder = this.shoulders[i];
      shoulder.position.set(side * BONES.shoulderOut, 0, BONES.shoulderUp);
      this.spine.add(shoulder);
      part(g.sleeve, this.shirt, shoulder, 0, 0, 0.01);
      part(g.upperArm, skin, shoulder);
      const elbow = this.elbows[i];
      elbow.position.z = -BONES.upperArm;
      shoulder.add(elbow);
      part(g.forearm, skin, elbow);
      part(g.hand, skin, elbow, 0, 0.004, -BONES.forearm - BONES.hand + 0.02);

      const hip = this.hips[i];
      hip.rotation.order = 'YXZ';
      hip.position.x = side * BONES.hipOut;
      this.pelvis.add(hip);
      part(g.shortsLeg, this.shorts, hip, 0, 0, 0.03);
      part(g.thigh, legs, hip);
      const knee = this.knees[i];
      knee.position.z = -BONES.thigh;
      hip.add(knee);
      if (look.trousers !== true) part(g.pad, pad, knee, 0, 0.012, -0.03);
      part(g.shin, legs, knee);
      part(g.sock, look.trousers === true ? legs : sock, knee, 0, 0, -BONES.shin + 0.17);
      const ankle = this.ankles[i];
      ankle.position.z = -BONES.shin;
      knee.add(ankle);
      part(g.shoe, shoe, ankle, 0, 0.055, -BONES.ankle + 0.038);
    });
  }

  restyle(look: Look): void {
    if (look === this.look) return;
    const key = JSON.stringify(look.kit);
    if (key === this.kitKey && look.trim === this.look.trim) return;
    this.look = look;
    this.kitKey = key;
    this.shirt.map?.dispose();
    this.shirt.map = shirtTexture(look);
    this.shirt.needsUpdate = true;
    this.shorts.color.set(look.kit.shorts);
  }

  /** Put the body where the motion has it, every joint at its angle. */
  pose(b: Body): void {
    const r = b.rig;
    this.root.position.set(b.x, b.y, b.lift);
    this.root.rotation.set(0, 0, b.yaw);
    this.root.scale.setScalar(b.scale);
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

  dispose(): void {
    this.shirt.map?.dispose();
    for (const m of this.materials) m.dispose();
  }
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
  /** Each side's coach, made the first time the court is drawn. */
  private coaches: [Figure, Figure] | null = null;
  /** The benches, rebuilt when the kits or the halves change. */
  private benches: Group | null = null;
  private benchKey = '';
  /** The people in the stand, made the first time the court is drawn. */
  private crowd: Crowd | null = null;
  private readonly ball: Mesh;
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

    // Arena lighting: bright from above, a warm bounce off the court.
    const sky = new HemisphereLight('#e8eeff', '#9a6a4c', 1.35);
    sky.position.set(0, 0, 1);
    this.scene.add(sky);
    const key = new DirectionalLight('#ffffff', 1.9);
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
    const fill = new DirectionalLight('#dfe6f5', 0.55);
    fill.position.set(14, -3, 6);
    this.scene.add(fill);

    // Shadows only: the painted floor shows through everywhere else.
    const floor = new Mesh(new PlaneGeometry(40, 40), new ShadowMaterial({ opacity: 0.34 }));
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.scene.add(buildNet());
    this.scene.add(buildRefereeStand());
    this.scene.add(this.referee.root);

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
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    courtCamera(width, height, this.camera);
  }

  /** The crowd in the stand, `fill` full, in these sides' colours. */
  setCrowd(kits: [Kit, Kit], fill: number): void {
    if (this.crowd === null) {
      this.crowd = new Crowd(fill);
      this.scene.add(this.crowd.group);
    }
    this.crowd.setKits(kits);
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
    if (this.crowd !== null) {
      this.crowd.react(motion.cheer);
      this.crowd.update(now);
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** Where a player's head is on screen, CSS px — for the labels over them. */
  headOnScreen(p: number): { X: number; Y: number; s: number } | null {
    const f = this.figures.get(p);
    return f === undefined ? null : this.onScreen(f);
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
