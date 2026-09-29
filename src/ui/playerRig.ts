/**
 * A player's body as a jointed skeleton, and the shapes it makes.
 *
 * The body is posed from a `Shape` — a handful of readable numbers: how low
 * the player sits, how far they lean and turn, where the feet are, and the
 * angles of each arm — so an animation is just a few shapes laid out in time
 * and blended. `buildRig` turns a shape, plus whatever running and looking
 * around the player is doing, into the angle of every joint: the arms come
 * straight from the shape, the legs are solved so the feet stay planted on
 * the floor (or tucked up under a jump) wherever the hips go. The 3D court
 * turns those angles into limbs; `jointPositions` works the same chain out by
 * hand, so the court can tell where a player's hands will be before they get
 * there — and stand them, and time their jump, so the hands meet the ball.
 *
 * The body frame: `x` to the player's right, `y` straight ahead, `z` up, the
 * origin on the floor under the hips. Lengths are for the reference player,
 * 1.95 m tall; everyone else is that body scaled to their own height. Angles
 * follow one rule: a positive rotation about `x` swings a limb hanging down
 * forwards (and tips one standing up backwards).
 */

export const REF_HEIGHT = 1.95;

/** Bone lengths of the reference player, m. */
export const BONES = {
  /** Ankle joint above the sole. */
  ankle: 0.085,
  shin: 0.47,
  thigh: 0.46,
  /** Each hip joint out from the middle. */
  hipOut: 0.095,
  /** Small of the back above the hip joints. */
  spine: 0.08,
  /** Shoulder joints above the small of the back, and out from the middle. */
  shoulderUp: 0.5,
  shoulderOut: 0.2,
  /** Top of the neck above the small of the back, and the head's centre above that. */
  neck: 0.63,
  head: 0.1,
  upperArm: 0.36,
  forearm: 0.3,
  /** Palm centre beyond the wrist. */
  hand: 0.08,
} as const;

/** Hip joints above the floor, standing straight. */
export const HIP_HEIGHT = BONES.ankle + BONES.shin + BONES.thigh;

/**
 * A body shape. Arms are named for the hitting arm (`h…`) and the other one
 * (`o…`), so one shape serves right- and left-handers alike; turns and side
 * bends are positive towards the hitting side.
 */
export interface Shape {
  /** Hips dropped below standing height, m. */
  crouch: number;
  /** Hips shifted forward (+) or back (-) over the feet, m. */
  hipShift: number;
  /** Pelvis tipped forward, rad. */
  tilt: number;
  /** Back bent forward (+) or arched (-), rad. */
  lean: number;
  /** Shoulders turned so the hitting shoulder goes back, rad. */
  twist: number;
  /** Trunk bent sideways towards the hitting side, rad. */
  bend: number;
  /** Head tipped down (+) or up (-), rad. */
  nod: number;
  /** Each foot out from the middle, m. */
  stance: number;
  /** Other-side foot ahead of the hitting-side foot, m. */
  stride: number;
  /** Feet drawn up under the body, m — only in the air. */
  tuck: number;
  /** Toes pointed, rad — only in the air. */
  point: number;
  /** Shoulder: raised forward (flex), out to the side (abd), turned about the
   *  arm (twist); and the elbow bent. Straight up is a flex of π. */
  hFlex: number;
  hAbd: number;
  hTwist: number;
  hElbow: number;
  oFlex: number;
  oAbd: number;
  oTwist: number;
  oElbow: number;
}

const SHAPE_KEYS = [
  'crouch', 'hipShift', 'tilt', 'lean', 'twist', 'bend', 'nod', 'stance', 'stride', 'tuck', 'point',
  'hFlex', 'hAbd', 'hTwist', 'hElbow', 'oFlex', 'oAbd', 'oTwist', 'oElbow',
] as const satisfies ReadonlyArray<keyof Shape>;

export function mixShape(a: Shape, b: Shape, t: number): Shape {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out = { ...a };
  for (const k of SHAPE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Both arms alike. */
export function arms(flex: number, abd: number, elbow: number, twist = 0): Partial<Shape> {
  return { hFlex: flex, hAbd: abd, hElbow: elbow, hTwist: twist, oFlex: flex, oAbd: abd, oElbow: elbow, oTwist: twist };
}

/** Standing easy between rallies. */
export const STAND: Shape = {
  crouch: 0.02, hipShift: 0, tilt: 0.03, lean: 0.04, twist: 0, bend: 0, nod: 0.08,
  stance: 0.12, stride: 0.05, tuck: 0, point: 0,
  hFlex: 0.1, hAbd: 0.14, hTwist: 0, hElbow: 0.35, oFlex: 0.1, oAbd: 0.14, oTwist: 0, oElbow: 0.35,
};

export function shape(base: Shape, over: Partial<Shape>): Shape {
  return { ...base, ...over };
}

/** On the toes while the ball is live: knees bent, hands up in front. */
export const READY: Shape = shape(STAND, {
  crouch: 0.17, hipShift: -0.04, tilt: 0.28, lean: 0.24, nod: -0.4, stance: 0.26, stride: 0.1,
  ...arms(0.62, 0.3, 1.35),
});

/** Low under a team-mate's attack, hands open for a ball off the block. */
export const COVER: Shape = shape(READY, {
  crouch: 0.36, hipShift: -0.08, tilt: 0.42, lean: 0.36, nod: -0.65, stance: 0.34, stride: 0.16,
  ...arms(0.85, 0.42, 0.55),
});

/** The server with the ball in both hands in front of them. */
export const HOLD: Shape = shape(STAND, {
  crouch: 0.04, lean: 0.12, nod: 0.25, stride: 0.12, ...arms(0.5, -0.26, 0.9),
});

// ---- The rig: every joint's angle ----------------------------------------------

/** Euler angles of a joint (applied `z` first, then `y`, then `x` — except the
 *  hips, `z`, `x`, then `y`), the bend of the joint beyond it (elbow, knee),
 *  and the angle of the one beyond that (wrist, ankle). */
export interface Limb {
  x: number;
  y: number;
  z: number;
  bend: number;
  end: number;
}

export interface Rig {
  pelvis: { y: number; z: number; pitch: number };
  spine: { x: number; y: number; z: number };
  head: { x: number; z: number };
  /** Each shoulder joint lifted as the arm goes up, m: [left, right]. */
  shoulderLift: [number, number];
  arms: [Limb, Limb];
  legs: [Limb, Limb];
}

/** What a player is doing beyond the shape: running, looking about. */
export interface Motion {
  /** +1 for a right-hander, -1 for a left-hander. */
  hand: 1 | -1;
  /** Running-cycle phase, rad: each foot swings through once per turn. */
  gait: number;
  /** Velocity in the body frame, m/s: `x` to the right, `y` ahead. */
  moveX: number;
  moveY: number;
  /** 0 on the floor, 1 in the air. */
  airborne: number;
  /** Where the head turns to, rad, relative to the way the body faces. */
  lookYaw: number;
  lookPitch: number;
}

export const STILL: Motion = { hand: 1, gait: 0, moveX: 0, moveY: 0, airborne: 0, lookYaw: 0, lookPitch: 0 };

/** Length of a running stride at a speed, m. */
export function strideLength(speed: number): number {
  return Math.min(1.3, 0.3 + 0.17 * speed);
}

/**
 * Solve a leg for an ankle target given in the pelvis's own frame, relative
 * to the hip joint: tip the leg's plane out to the side, then bend the hip and
 * knee within it, knee forwards.
 */
function solveLeg(dx: number, dy: number, dz: number): { x: number; y: number; bend: number } {
  const L1 = BONES.thigh;
  const L2 = BONES.shin;
  const down = Math.max(0.05, -dz);
  const y = Math.atan(dx / -down);
  const g = Math.hypot(dx, down);
  const D = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 0.02, Math.hypot(dy, g)));
  const alpha = Math.atan2(dy, g);
  const beta = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))));
  const inner = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2))));
  return { x: alpha + beta, y, bend: Math.PI - inner };
}

/** The angle of every joint for a shape, with running and looking laid on top. */
export function buildRig(s: Shape, m: Motion): Rig {
  const speed = Math.hypot(m.moveX, m.moveY);
  // How much of a running cycle shows: none standing, all of it at a jog.
  const run = Math.min(1, speed / 1.4) * (1 - m.airborne);
  const stride = strideLength(speed);
  // Running, the hips sink as each foot takes the weight under the body and
  // rise through the stride.
  const bob = run * 0.03 * (1 - Math.abs(Math.sin(m.gait)));
  // Leaning into the run, a little more the faster it is.
  const drive = Math.min(0.12, 0.022 * Math.max(0, m.moveY)) * (1 - m.airborne);

  const pelvisZ = HIP_HEIGHT - s.crouch - bob;
  const pitch = -(s.tilt + drive);

  // Arms: the hitting arm is the right one for a right-hander. Running swings
  // them against the legs, less so the more an arm is already doing.
  const swing = 0.75 * run * Math.min(1, speed / 3);
  const armOf = (side: -1 | 1): Limb => {
    const hitting = side === m.hand;
    const flex = hitting ? s.hFlex : s.oFlex;
    const abd = hitting ? s.hAbd : s.oAbd;
    const twist = hitting ? s.hTwist : s.oTwist;
    const elbow = hitting ? s.hElbow : s.oElbow;
    const free = Math.max(0, 1 - Math.abs(flex) / 1.6);
    return {
      // Each arm forward with the opposite foot.
      x: flex + side * swing * free * Math.sin(m.gait),
      y: -side * abd,
      z: side * twist,
      bend: elbow + Math.max(0, 1.5 - elbow) * run * free * 0.8,
      end: 0,
    };
  };

  // Legs: each ankle placed on the floor, the running cycle swinging it along
  // the way the player is moving and lifting it on the way through.
  const dirX = speed > 1e-3 ? m.moveX / speed : 0;
  const dirY = speed > 1e-3 ? m.moveY / speed : 0;
  const legOf = (side: -1 | 1): Limb => {
    const ahead = side === m.hand ? -s.stride / 2 : s.stride / 2;
    const phase = m.gait + (side === 1 ? Math.PI : 0);
    // Feet land under the body rather than far out in front, and the heel
    // kicks up behind on the way through.
    const reach = Math.min(0.42, stride / 2) * run * Math.sin(phase);
    const lift = run * (0.05 + 0.04 * speed) * Math.max(0, Math.cos(phase)) * (1 - 0.55 * Math.sin(phase));
    const ax = side * s.stance + dirX * reach;
    const ay = ahead + dirY * reach - m.airborne * s.tuck * 0.45;
    const az = BONES.ankle + lift + m.airborne * s.tuck;
    // Into the pelvis's frame: from the hip joint, then undo the pelvis's tip.
    const dx = ax - side * BONES.hipOut;
    const vy = ay - s.hipShift;
    const vz = az - pelvisZ;
    const c = Math.cos(-pitch);
    const sn = Math.sin(-pitch);
    const leg = solveLeg(dx, vy * c - vz * sn, vy * sn + vz * c);
    // The foot kept flat on the floor, pointed in the air or pushing off a stride.
    const push = run * 0.35 * Math.max(0, -Math.sin(phase));
    return { x: leg.x, y: leg.y, z: 0, bend: leg.bend, end: leg.bend - leg.x - pitch - m.airborne * s.point - push };
  };

  const twist = -s.twist * m.hand;
  const armL = armOf(-1);
  const armR = armOf(1);
  const shoulderLift = (flex: number): number => 0.05 * Math.min(1, Math.max(0, (flex - 1.6) / 1.4));
  return {
    pelvis: { y: s.hipShift, z: pelvisZ, pitch },
    spine: { x: -(s.lean + drive), y: s.bend * m.hand, z: twist },
    head: {
      x: Math.max(-0.9, Math.min(0.7, -s.nod + m.lookPitch)),
      z: Math.max(-1.1, Math.min(1.1, m.lookYaw - twist)),
    },
    shoulderLift: [shoulderLift(armL.x), shoulderLift(armR.x)],
    arms: [armL, armR],
    legs: [legOf(-1), legOf(1)],
  };
}

// ---- Working out where the joints are ----------------------------------------------

type M3 = [number, number, number, number, number, number, number, number, number];
export type V3 = [number, number, number];

const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function mul(a: M3, b: M3): M3 {
  const o = [0, 0, 0, 0, 0, 0, 0, 0, 0] as M3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return o;
}

function apply(m: M3, v: V3): V3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

const rx = (a: number): M3 => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const ry = (a: number): M3 => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rz = (a: number): M3 => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];

interface Frame {
  m: M3;
  t: V3;
}

function child(f: Frame, offset: V3, rot: M3 = I3): Frame {
  const o = apply(f.m, offset);
  return { m: mul(f.m, rot), t: [f.t[0] + o[0], f.t[1] + o[1], f.t[2] + o[2]] };
}

export interface Joints {
  head: V3;
  shoulders: [V3, V3];
  hands: [V3, V3];
  ankles: [V3, V3];
}

/** Where a rig puts the joints, in the body frame of the reference player. */
export function jointPositions(r: Rig): Joints {
  const pelvis = child({ m: I3, t: [0, 0, 0] }, [0, r.pelvis.y, r.pelvis.z], rx(r.pelvis.pitch));
  const spine = child(pelvis, [0, 0, BONES.spine], mul(mul(rx(r.spine.x), ry(r.spine.y)), rz(r.spine.z)));
  const head = child(child(spine, [0, 0, BONES.neck], mul(rx(r.head.x), rz(r.head.z))), [0, 0, BONES.head]);
  const sides = [-1, 1] as const;
  const shoulders = sides.map((side, i) => {
    const a = r.arms[i];
    return child(spine, [side * BONES.shoulderOut, 0, BONES.shoulderUp + r.shoulderLift[i]],
      mul(mul(rx(a.x), ry(a.y)), rz(a.z)));
  });
  const hands = shoulders.map((sh, i) => {
    const elbow = child(sh, [0, 0, -BONES.upperArm], rx(r.arms[i].bend));
    return child(child(elbow, [0, 0, -BONES.forearm]), [0, 0, -BONES.hand]).t;
  });
  const ankles = sides.map((side, i) => {
    const l = r.legs[i];
    const hip = child(pelvis, [side * BONES.hipOut, 0, 0], mul(ry(l.y), rx(l.x)));
    const knee = child(hip, [0, 0, -BONES.thigh], rx(-l.bend));
    return child(knee, [0, 0, -BONES.shin]).t;
  });
  return {
    head: head.t,
    shoulders: [shoulders[0].t, shoulders[1].t],
    hands: [hands[0], hands[1]],
    ankles: [ankles[0], ankles[1]],
  };
}
