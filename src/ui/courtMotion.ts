/**
 * How the players on the live court move, frame by frame.
 *
 * The match script (matchCourt.ts) hands over one scene per beat: where
 * everyone should be, what they are doing, and where the ball is flying —
 * the contact at the end of each flight made by the scene's actor. Between
 * scenes this module makes the motion continuous. Players run, shuffle and
 * backpedal to their marks, facing the ball the way players do, with their
 * legs keeping step. Each contact is a timed move built so the hands meet
 * the ball as it arrives: a passer drops to the ball's height behind a
 * platform angled at the setter; a digger lunges in low; a setter squares up
 * to the left antenna with the hands above the forehead, jumps into the ball
 * and sends it forwards or arches it back; a hitter runs in, plants, swings
 * both arms up into a jump that peaks at the contact, draws the hitting arm
 * back and whips it through; blockers load, go up just after the hitter and
 * reach over the net; a jump server tosses, runs in under the toss and hits
 * it at the top of the jump. Each player stands and jumps where their own
 * reach (they are scaled to their real height) puts the hands on the ball.
 * When the ball lands, the side that won the point celebrates and the other
 * lets it sink in.
 *
 * Off the court, the bench side: the substitutes stand in the warm-up area,
 * a square in the corner — volleyball players don't sit — those sent to warm
 * up sprinting and jumping in it; a libero, or the middle he has replaced,
 * waits by the coach, who stands at the front of the bench and claps a point
 * won or puts his hands on his hips at one lost. A substitution goes through
 * the substitution zone at the sideline: the player coming on meets the one
 * coming off there, hands slap, and each goes on his way.
 */

import {
  ballAlong, flightBulge, NET_HEIGHT, tossesWithBothHands, type Ball3, type Pose, type Scene,
} from './matchCourt.ts';
import {
  arms, buildRig, COVER, HOLD, jointPositions, mixShape, READY, REF_HEIGHT, shape, STAND, STILL, strideLength,
  type Rig, type Shape, type V3,
} from './playerRig.ts';
import type { Cheer } from './crowd3d.ts';

// ---- Shapes the contacts pass through ----------------------------------------------

const APPROACH = shape(READY, { crouch: 0.1, tilt: 0.3, lean: 0.34, nod: -0.5, stride: 0.14, ...arms(0.35, 0.2, 1.0) });
/** The last, long step of a run-up: hips low, both arms thrown back. */
const LOAD = shape(READY, {
  crouch: 0.34, hipShift: -0.1, tilt: 0.5, lean: 0.52, nod: -0.8, stance: 0.2, stride: 0.3, ...arms(-1.05, 0.25, 0.25),
});
/** Leaving the floor, both arms swinging up. */
const TAKEOFF = shape(STAND, {
  crouch: 0.02, tilt: 0.1, lean: 0.12, nod: -0.7, stance: 0.14, stride: 0.1, ...arms(2.4, 0.3, 0.5),
});
/** Bow and arrow: the other arm up at the ball, the hitting arm drawn back, elbow high. */
const COCKED = shape(TAKEOFF, {
  lean: -0.28, twist: 0.55, bend: 0.05, nod: -0.5, tuck: 0.32, point: 0.6,
  hFlex: 3.25, hAbd: 0.75, hElbow: 2.1, oFlex: 2.75, oAbd: 0.15, oElbow: 0.15,
});
/** The hit: the arm whipped through straight, the trunk snapping forward. */
const STRIKE = shape(COCKED, {
  lean: 0.12, twist: -0.3, bend: -0.2, nod: 0.1, tuck: 0.18,
  hFlex: 2.85, hAbd: 0.2, hElbow: 0.08, oFlex: 1.0, oAbd: 0.35, oElbow: 1.3,
});
const FOLLOW = shape(STRIKE, {
  lean: 0.5, twist: -0.45, bend: -0.1, nod: 0.2, tuck: 0.12,
  hFlex: 0.55, hAbd: -0.3, hElbow: 0.35, oFlex: 0.4, oAbd: 0.3, oElbow: 1.0,
});
const LAND = shape(READY, {
  crouch: 0.32, tilt: 0.45, lean: 0.42, stance: 0.24, stride: 0.12, nod: -0.2, ...arms(0.7, 0.35, 0.7),
});

/** Straight arms locked together, angled up, the legs doing the work. */
const PLATFORM = shape(READY, {
  crouch: 0.3, hipShift: -0.1, tilt: 0.4, lean: 0.32, nod: -0.75, stance: 0.3, stride: 0.18,
  ...arms(1.2, -0.27, 0.04),
});
const PLATFORM_HIT = shape(PLATFORM, { crouch: 0.25, tilt: 0.34, lean: 0.26, nod: -0.55, ...arms(1.32, -0.27, 0.02) });
/** Held on towards the target after the pass. */
const PLATFORM_HOLD = shape(PLATFORM, { crouch: 0.17, lean: 0.2, nod: -0.4, ...arms(1.45, -0.25, 0.05) });
/** Down in a long lunge under a hard-driven ball. */
const DIG_LOW = shape(PLATFORM, {
  crouch: 0.46, hipShift: 0.02, tilt: 0.55, lean: 0.4, stance: 0.4, stride: 0.44, nod: -0.9, ...arms(1.1, -0.27, 0.04),
});
const DIG_HIT = shape(DIG_LOW, { ...arms(1.22, -0.25, 0.03) });
const DIG_UP = shape(DIG_LOW, { crouch: 0.34, lean: 0.34, stride: 0.34, ...arms(1.0, -0.2, 0.1) });

/** Squared up under the ball, hands shaped above the forehead. */
const SET_PREP = shape(READY, {
  crouch: 0.16, hipShift: 0, tilt: 0.12, lean: -0.02, nod: -0.75, stance: 0.2, stride: 0.16, ...arms(2.55, 0.42, 1.75),
});
const SET_TOUCH = shape(SET_PREP, { crouch: 0.08, tuck: 0.08, point: 0.4, ...arms(2.7, 0.38, 1.2) });
const SET_OUT = shape(SET_PREP, { crouch: 0.02, lean: -0.05, nod: -0.5, tuck: 0.06, point: 0.4, ...arms(2.95, 0.3, 0.15) });
/** A back set: arched, the arms carrying on over the head. */
const BACK_SET_OUT = shape(SET_OUT, { lean: -0.42, nod: -0.9, ...arms(3.35, 0.3, 0.2) });

/** At the net, hands up at the tape, ready to go. */
const BLOCK_READY = shape(READY, {
  crouch: 0.14, hipShift: 0, tilt: 0.1, lean: 0.05, nod: -0.3, stance: 0.24, stride: 0, ...arms(2.2, 0.38, 1.6),
});
const BLOCK_LOAD = shape(BLOCK_READY, { crouch: 0.32, tilt: 0.25, lean: 0.14, ...arms(2.0, 0.4, 1.75) });
const BLOCK_UP = shape(BLOCK_READY, { crouch: 0.03, tilt: 0.05, lean: 0.1, nod: -0.2, tuck: 0.1, point: 0.5, ...arms(2.65, 0.2, 0.3) });
/** Hands pressed over the net into the hitter's side. */
const BLOCK_PEAK = shape(BLOCK_UP, { lean: 0.16, tuck: 0.14, ...arms(2.72, 0.14, 0.05) });
const BLOCK_LAND = shape(BLOCK_READY, { crouch: 0.3, tilt: 0.3, lean: 0.2, ...arms(2.1, 0.4, 1.4) });

/** The toss for a jump serve, thrown high and forward with the hitting hand. */
const TOSS = shape(STAND, {
  crouch: 0.05, lean: 0, nod: -0.6, stride: 0.2, hFlex: 2.9, hAbd: 0.2, hElbow: 0.1, oFlex: 0.3, oAbd: 0.2, oElbow: 0.4,
});
/** A float serve: the other hand lifts the ball, the hitting arm draws back… */
const FLOAT_TOSS = shape(STAND, {
  crouch: 0.06, nod: -0.6, stride: 0.3, twist: 0.35, hFlex: 2.4, hAbd: 0.9, hElbow: 1.9, oFlex: 2.4, oAbd: 0.1, oElbow: 0.15,
});
/** …or both hands lift it, together, up past the face. */
const FLOAT_TOSS_BOTH = shape(STAND, {
  crouch: 0.04, nod: -0.65, stride: 0.26, twist: 0.1, hFlex: 2.55, hAbd: 0.22, hElbow: 0.35, oFlex: 2.55, oAbd: 0.22, oElbow: 0.35,
});
const FLOAT_COCK = shape(FLOAT_TOSS, { hFlex: 3.2, hAbd: 0.85, hElbow: 2.0, oFlex: 2.2, twist: 0.45, lean: -0.1, stride: 0.34 });
/** …and punches through the middle of the ball, stopping dead. */
const FLOAT_HIT = shape(FLOAT_COCK, {
  twist: -0.1, lean: 0.12, stride: 0.5, hFlex: 2.8, hAbd: 0.3, hElbow: 0.05, oFlex: 0.8, oAbd: 0.3, oElbow: 1.0,
});
const FLOAT_HOLD = shape(FLOAT_HIT, { lean: 0.15, hFlex: 2.3, hElbow: 0.1 });

const ARMS_UP = shape(STAND, { lean: -0.12, nod: -0.4, ...arms(2.85, 0.62, 0.2) });
/** A coach between points: arms folded, watching. */
const COACH_IDLE = shape(STAND, { nod: 0.06, ...arms(0.62, -0.32, 2.15) });
/** One hand up for a slap as a substitute comes on. */
const SLAP = shape(STAND, { lean: 0.05, nod: -0.1, hFlex: 2.6, hAbd: 0.35, hElbow: 0.35, oFlex: 0.3, oAbd: 0.25, oElbow: 0.6 });
const FIST = shape(STAND, { crouch: 0.06, lean: -0.1, nod: -0.25, hFlex: 1.75, hAbd: 0.35, hElbow: 2.3, oFlex: 0.4, oAbd: 0.3, oElbow: 1.2 });
const FIST_DOWN = shape(FIST, { crouch: 0.16, lean: 0.18, nod: 0.1, hFlex: 1.05, hElbow: 2.4 });
const CLAP_OPEN = shape(STAND, { nod: -0.1, ...arms(1.35, 0.32, 1.1) });
const CLAP = shape(CLAP_OPEN, { ...arms(1.42, -0.12, 1.0) });
/** Hands on hips, head down. */
const HIPS = shape(STAND, { lean: 0.06, nod: 0.45, ...arms(-0.25, 0.55, 1.9, 0.6) });

/** Running flat out: tall, leaning into it, elbows bent and the arms pumping. */
const RUN = shape(STAND, { crouch: 0.05, tilt: 0.1, lean: 0.14, nod: -0.05, stance: 0.1, stride: 0, ...arms(0.1, 0.12, 1.5) });

// ---- The referee's signals, as the FIVB rules give them ----------------------------------
//
// The arms are worked out so the hands land where the signal puts them: the
// whistle at the mouth, an arm straight out at shoulder height, the palm of
// one hand across the fingers of the other for a time-out.

/** Up on the stand between calls, hands together in front. */
const REF_REST = shape(STAND, {
  nod: 0.05, stance: 0.14, stride: 0,
  hFlex: 0.13, hAbd: -0.69, hTwist: -1.14, hElbow: 0.9, oFlex: 0.13, oAbd: -0.69, oTwist: -1.14, oElbow: 0.9,
});
const WHISTLE = shape(REF_REST, { nod: -0.05, hFlex: 0.36, hAbd: -0.94, hTwist: 0.92, hElbow: 2.41 });
/** An arm straight out towards a side: the hitting (right) arm, or the other. */
const POINT_H = shape(REF_REST, { hFlex: 1.25, hAbd: 1.5, hTwist: 0.14, hElbow: 0.2 });
const POINT_O = shape(REF_REST, { oFlex: 1.25, oAbd: 1.5, oTwist: 0.14, oElbow: 0.2 });
/** The serve waved on: the arm swept across, from the server's side towards the other. */
const SWEEP_H = shape(REF_REST, { hFlex: 1.51, hAbd: -0.75, hTwist: -1.45, hElbow: 0 });
const SWEEP_O = shape(REF_REST, { oFlex: 1.51, oAbd: -0.75, oTwist: -1.45, oElbow: 0 });
/** Time-out: one hand flat across the fingers of the other, a T. */
const TIME_OUT = shape(REF_REST, {
  nod: -0.05, hFlex: 0.24, hAbd: -0.11, hTwist: 0.65, hElbow: 2.19, oFlex: 1.72, oAbd: 0.44, oTwist: 1.47, oElbow: 2.17,
});
/** Ball out: both forearms raised, palms towards the body. */
const BALL_OUT = shape(REF_REST, { ...arms(0.93, 0.23, 2.4, -0.09) });

/** The posture each pose settles into between contacts. */
function postureOf(pose: Pose): Shape {
  switch (pose) {
    case 'stand': return STAND;
    case 'cover': return COVER;
    case 'hold': return HOLD;
    default: return READY;
  }
}

// ---- Timelines ------------------------------------------------------------------------

type Ease = 'smooth' | 'whip';

interface Key {
  /** ms from the contact. */
  t: number;
  s: Shape;
  /** How the move into this key accelerates. */
  ease: Ease;
}

interface Jump {
  /** Takeoff, top and landing, ms from the contact; height of the top, m. */
  up: number;
  peak: number;
  down: number;
  h: number;
}

interface Path {
  /** Where the run-up starts — the player heads there until it begins, and
   *  runs from wherever they have got to — the plant it runs to, and where
   *  the jump lands. */
  from: { x: number; y: number };
  started: boolean;
  plant: { x: number; y: number };
  land: { x: number; y: number };
  /** Run-up start, takeoff and landing, ms from the contact. */
  go: number;
  up: number;
  down: number;
}

type ActionKind = Pose | 'celebrate' | 'dejected';

interface Action {
  kind: ActionKind;
  /** When it began and when the hands meet the ball, ms on the animation clock. */
  t0: number;
  tc: number;
  keys: Key[];
  jump: Jump | null;
  /** The way the player faces through it, rad. */
  yaw: number | null;
  path: Path | null;
  /** When it has handed back to the player's posture, ms from the contact. */
  end: number;
}

/** Keys laid out in time: none earlier than the action's start, and always in order. */
function timeline(pre: number, keys: Array<[number, Shape, Ease?]>): Key[] {
  const out: Key[] = [];
  for (const [t, s, ease] of keys) {
    const prev = out[out.length - 1];
    const at = Math.max(-pre, t, prev !== undefined ? prev.t + 1 : -Infinity);
    out.push({ t: at, s, ease: ease ?? 'smooth' });
  }
  return out;
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function sample(keys: Key[], rel: number): Shape {
  if (rel <= keys[0].t) return keys[0].s;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (rel < b.t) {
      const a = keys[i - 1];
      const u = (rel - a.t) / (b.t - a.t);
      return mixShape(a.s, b.s, b.ease === 'whip' ? u * u : smooth(u));
    }
  }
  return keys[keys.length - 1].s;
}

function liftAt(j: Jump, rel: number): number {
  if (rel <= j.up || rel >= j.down) return 0;
  const u = rel < j.peak ? (j.peak - rel) / (j.peak - j.up) : (rel - j.peak) / (j.down - j.peak);
  return j.h * (1 - u * u);
}

/** Half the time in the air for a jump of height `h` m, ms — squeezed into `room` ms if it must be. */
function hangTime(h: number, room: number): number {
  return Math.max(120, Math.min(Math.sqrt((2 * Math.max(0.05, h)) / 9.81) * 1000, room));
}

// ---- Bodies ---------------------------------------------------------------------------

/** What the court needs to know about each player to build their body. */
export interface Figure {
  /** Height, m. */
  height: number;
  /** +1 right-handed, -1 left-handed. */
  hand: 1 | -1;
}

export interface Body {
  x: number;
  y: number;
  /** Where the script wants them. */
  tx: number;
  ty: number;
  /** Where they stand to make their contact, relative to that. */
  ox: number;
  oy: number;
  /** Floor velocity, m/s, smoothed. */
  vx: number;
  vy: number;
  /** The way they face: 0 looks along +y, towards the far end. */
  yaw: number;
  /** Feet off the floor, m, and how fast that is changing when falling. */
  lift: number;
  vz: number;
  pose: Pose;
  /** The resting shape, eased towards what the pose asks for. */
  posture: Shape;
  /** Last frame's shape, for blending out of a move cut short. */
  shape: Shape;
  gait: number;
  /** How far into a proper upright run they are, 0 to 1. */
  running: number;
  action: Action | null;
  reaction: Action | null;
  fade: { from: Shape; t0: number } | null;
  alpha: number;
  leaving: boolean;
  /** Size relative to the reference body. */
  scale: number;
  hand: 1 | -1;
  /** Small differences between players' idling and celebrating. */
  seed: number;
  /** Every joint's angle, this frame. */
  rig: Rig;
  /** Off the court: in the warm-up area as a substitute, or by the bench to go back on — null on it. */
  side: 'bench' | 'wait' | null;
  /** A point to pass through on the way to the mark: the substitution zone, on a change. */
  via: { x: number; y: number } | null;
  /** Their place by the bench, that a substitute warming up runs from and back to. */
  home: { x: number; y: number } | null;
}

/** Who is off the court for each side, and what they are doing. */
export interface CourtSideline {
  /** The substitutes, by side: they wait in the warm-up area. */
  bench: [number[], number[]];
  /** A libero, or the middle he has replaced, waiting by the bench to go back on. */
  waiting: [number[], number[]];
  /** Those sent to warm up. */
  warming: ReadonlySet<number>;
}

/**
 * The bench side of the hall: the far sideline, each team along its own half.
 * The warm-up area is a white square in the corner beyond the end line, the
 * bench along the boards, the coach at its front by the attack line, a
 * libero's waiting spot beside him, and the substitution zone at the sideline
 * between the attack line and the net. `y` is for the team on the positive
 * half; the other's is mirrored.
 */
export const SIDELINE = {
  warmup: { x0: -7.15, x1: -5.05, y0: 9.85, y1: 12.15 },
  bench: { x: -6.95, y0: 4.7, y1: 8.7 },
  coach: { x: -6.05, y: 4.05 },
  wait: { x: -5.55, y: 4.95, step: 0.75 },
  sub: { x: -4.95, in: 2.3, out: 1.35 },
} as const;

/** A substitute's place in the warm-up area: three abreast, rows back towards the end boards. */
function warmupSpot(i: number, side: number): { x: number; y: number } {
  // Two staggered rows along the end line, so from the camera across the
  // court no one stands right behind another.
  const w = SIDELINE.warmup;
  const row = i % 2;
  const col = Math.floor(i / 2) % 4;
  const deep = Math.floor(i / 8) * 0.3;
  return { x: w.x0 + 0.5 + row * 1.05 + deep, y: side * (w.y0 + 0.3 + col * 0.52 + row * 0.26) };
}

/** The coach of a team, by the side its bench is on. */
export function coachSpot(side: number): { x: number; y: number } {
  return { x: SIDELINE.coach.x, y: side * SIDELINE.coach.y };
}

export interface Flight {
  from: Ball3;
  to: Ball3;
  /** Parabola bulge actually used, after solving for the apex and net clearance. */
  bulge: number;
  t0: number;
  ms: number;
  /** Spin about the horizontal axis across the flight, rad/s — topspin positive. */
  spin: number;
  /** A float serve: no spin, so it wobbles off its line in the air. */
  float?: boolean;
}

export function flightAt(f: Flight, now: number): Ball3 {
  const t = f.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - f.t0) / f.ms));
  const at = ballAlong(f.from, f.to, f.bulge, t);
  if (f.float === true) {
    // Knuckling: a drift either way that grows and dies away, back on line as it arrives.
    const w = Math.sin(t * Math.PI) * Math.sin(t * Math.PI * 3.4) * 0.16;
    at.x += w;
    at.z += w * 0.35;
  }
  return at;
}

/** Top running speed and how quickly players close on their mark. */
const MAX_SPEED = 7.5; // m/s
const SETTLE = 0.2; // s
const TURN_RATE = 10; // rad/s

/** How fast the ball spins off each kind of contact. */
const SPIN: Partial<Record<Pose, number>> = { spike: 32, serve: 36, float: 0.4, set: -3, receive: 6, dig: 9, pass: 5 };

const CONTACTS: ReadonlySet<Pose> = new Set<Pose>(['serve', 'float', 'receive', 'dig', 'pass', 'set', 'spike', 'block']);

/** The way something at (dx, dy) from a player lies, as a facing. */
function yawTo(dx: number, dy: number): number {
  return Math.atan2(-dx, dy);
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** A facing kept within `max` of `around`. */
function clampYaw(yaw: number, around: number, max: number): number {
  const d = wrap(yaw - around);
  return around + Math.max(-max, Math.min(max, d));
}

/** Body-frame offset (right, ahead) in court metres for a player facing `yaw`. */
function toCourt(yaw: number, right: number, ahead: number): { x: number; y: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: right * c - ahead * s, y: right * s + ahead * c };
}

/** Where a shape puts the hitting hand, or the middle of both hands, in the body frame. */
function reach(s: Shape, hand: 1 | -1, which: 'hit' | 'both', scale: number): V3 {
  const j = jointPositions(buildRig(s, { ...STILL, hand }));
  const h = which === 'hit'
    ? j.hands[hand === 1 ? 1 : 0]
    : [(j.hands[0][0] + j.hands[1][0]) / 2, (j.hands[0][1] + j.hands[1][1]) / 2, (j.hands[0][2] + j.hands[1][2]) / 2] as V3;
  return [h[0] * scale, h[1] * scale, h[2] * scale];
}

/** Where the first referee's stand is: off the far sideline beside the post, a
 *  little towards the near end so the post doesn't hide them; and how high
 *  the platform is, putting their eyes well above the tape. */
export const REFEREE_STAND = { x: -5.85, y: -0.6, height: 1.25 } as const;

/** What the referee is signalling: the serve waved on, the point to a side, a time-out. */
export type Call = 'serve' | 'point' | 'timeout';

export interface Signal {
  kind: Call;
  /** The side it is for: who serves, who won the point, who called the time-out. */
  team: 0 | 1;
  /** The point came from a ball out, signalled before the point. */
  out: boolean;
  /** When it began and ends, and when the whistle blows, ms on the animation clock. */
  t0: number;
  end: number;
  whistle: [number, number];
}

/** The side of the net a player is on: +1 for the near half (negative y), which faces +y. */
function netYaw(y: number): number {
  return y <= 0 ? 0 : Math.PI;
}

/**
 * A run-up to a jump that peaks at the contact, `up` ms either side of it:
 * from where the player is now, starting `go` ms before the contact, into the
 * plant at takeoff, then carried on through the air so the contact comes
 * right over their mark — a longer run carries further (`carry` of it).
 */
function runUp(b: Body, go: number, up: number, carry: number, from = { x: b.x, y: b.y }): Path {
  const mark = { x: b.tx + b.ox, y: b.ty + b.oy };
  const dist = Math.hypot(mark.x - from.x, mark.y - from.y);
  const dx = dist > 1e-3 ? (mark.x - from.x) / dist : 0;
  const dy = dist > 1e-3 ? (mark.y - from.y) / dist : 0;
  const drift = Math.min(0.5, carry * dist);
  return {
    from,
    started: false,
    plant: { x: mark.x - (dx * drift) / 2, y: mark.y - (dy * drift) / 2 },
    land: { x: mark.x + (dx * drift) / 2, y: mark.y + (dy * drift) / 2 },
    go,
    up: -up,
    down: up,
  };
}

export class CourtMotion {
  readonly bodies = new Map<number, Body>();
  flight: Flight | null = null;
  /** The ball's last few positions, for the streak behind a fast one. */
  trail: Ball3[] = [];
  actor: number | null = null;
  private actorPose: Pose | null = null;
  private first = true;
  private point: { team: 0 | 1; at: number; out: boolean; big: boolean } | null = null;
  /** The last point won, for the crowd: whose, when, and whether it was one to get up for. */
  cheer: Cheer | null = null;

  /** The first referee, up on the stand, facing the court. */
  readonly referee: Body;
  /** Each side's coach, at the front of its bench. */
  readonly coaches: [Body, Body];
  /** Who is off the court, and the half each team plays on: -1 the near (negative y) one. */
  private sideline: CourtSideline | null = null;
  private sides: [number, number] = [-1, 1];
  /** Who was on the court in the last scene. */
  private onCourt = new Set<number>();
  /** What they are signalling now, if anything. */
  signal: Signal | null = null;
  /** How fast the match is being shown: the referee's signals keep pace. */
  pace = 1;
  /** Calls waiting for the referee: a point, a time-out. */
  private calls: Array<Pick<Signal, 'kind' | 'team' | 'out'>> = [];
  /** A rally is being played: the referee keeps their calls until it is over. */
  private live = false;
  /** The next serve still has to be waved on — from when, and for which side. */
  private needServe = true;
  private serveDue: number | null = null;
  private serveTeam: 0 | 1 | null = null;
  private stoppage: { timeout: 0 | 1 | null; paused: boolean } = { timeout: null, paused: false };

  constructor(
    private readonly figure: (p: number) => Figure,
    private readonly teamOf: (p: number) => 0 | 1,
  ) {
    const r = REFEREE_STAND;
    this.referee = {
      x: r.x, y: r.y, tx: r.x, ty: r.y, ox: 0, oy: 0, vx: 0, vy: 0, yaw: -Math.PI / 2, lift: r.height, vz: 0,
      pose: 'stand', posture: REF_REST, shape: REF_REST, gait: 0, running: 0, action: null, reaction: null, fade: null,
      alpha: 1, leaving: false, scale: 1.85 / REF_HEIGHT, hand: 1, seed: 7,
      rig: buildRig(REF_REST, STILL), side: null, via: null, home: null,
    };
    this.coaches = [this.coachBody(0, -1), this.coachBody(1, 1)];
  }

  /** A coach, standing at the front of his bench and facing the court. */
  private coachBody(team: 0 | 1, side: number): Body {
    const at = coachSpot(side);
    return {
      x: at.x, y: at.y, tx: at.x, ty: at.y, ox: 0, oy: 0, vx: 0, vy: 0, yaw: yawTo(1, -side * 0.35), lift: 0, vz: 0,
      pose: 'stand', posture: COACH_IDLE, shape: COACH_IDLE, gait: 0, running: 0, action: null, reaction: null,
      fade: null, alpha: 1, leaving: false, scale: 1.82 / REF_HEIGHT, hand: 1, seed: 11 + team,
      rig: buildRig(COACH_IDLE, STILL), side: null, via: null, home: null,
    };
  }

  /**
   * Who is off the court, and which half each team is on (the near team on
   * the negative one): everyone not playing goes to their place by the
   * bench, anyone new there appears at it, and the coaches stand by theirs.
   */
  setSideline(sl: CourtSideline, nearTeam: 0 | 1, now: number): void {
    this.sideline = sl;
    this.sides = nearTeam === 0 ? [-1, 1] : [1, -1];
    this.coaches.forEach((c, t) => {
      const at = coachSpot(this.sides[t]);
      c.x = at.x;
      c.y = at.y;
      c.tx = at.x;
      c.ty = at.y;
      c.yaw = yawTo(1, -this.sides[t] * 0.35);
    });
    for (const [p, spot] of this.sideSpots()) {
      if (this.onCourt.has(p)) continue;
      let b = this.bodies.get(p);
      if (b === undefined) {
        b = this.spawn(p, spot.x, spot.y, 'stand');
        b.x = spot.x;
        b.y = spot.y;
        this.bodies.set(p, b);
      }
      b.side = spot.kind;
      b.home = { x: spot.x, y: spot.y };
      b.tx = spot.x;
      b.ty = spot.y;
      b.ox = 0;
      b.oy = 0;
      b.pose = 'stand';
      b.leaving = false;
    }
    void now;
  }

  /** Where everyone off the court belongs: substitutes in the warm-up area, the rest by the coach. */
  private sideSpots(): Map<number, { x: number; y: number; kind: 'bench' | 'wait' }> {
    const out = new Map<number, { x: number; y: number; kind: 'bench' | 'wait' }>();
    const sl = this.sideline;
    if (sl === null) return out;
    for (const t of [0, 1] as const) {
      const side = this.sides[t];
      sl.bench[t].forEach((p, i) => out.set(p, { ...warmupSpot(i, side), kind: 'bench' }));
      sl.waiting[t].forEach((p, i) => out.set(p, {
        x: SIDELINE.wait.x, y: side * (SIDELINE.wait.y + i * SIDELINE.wait.step), kind: 'wait',
      }));
    }
    return out;
  }

  /** Play stopped or not, and a time-out called: the referee signals the
   *  time-out once the rally in play is over, and waves no serve on until
   *  play is back on — and then waves it on again, even if it had been. */
  setStoppage(timeout: 0 | 1 | null, paused: boolean, now: number): void {
    if (timeout !== null && timeout !== this.stoppage.timeout) this.calls.push({ kind: 'timeout', team: timeout, out: false });
    const stopped = timeout !== null || paused;
    const was = this.stoppage.timeout !== null || this.stoppage.paused;
    if (stopped && !this.live) {
      this.needServe = true;
      this.serveDue = null;
    }
    if (!stopped && was && this.needServe) this.serveDue = now + 300 / this.pace;
    this.stoppage = { timeout, paused };
  }

  /** Hand over a new scene: new marks, postures and contacts, and a new flight. */
  scene(sc: Scene, now: number): void {
    const struck = this.actorPose;
    const from = this.flight !== null ? flightAt(this.flight, now) : sc.ball;
    if (sc.ball !== null && from !== null) {
      // A ball still in the server's hands leaves them only at the toss.
      const held = Math.min(sc.release ?? 0, sc.ms * 0.8);
      this.flight = {
        from, to: sc.ball, bulge: flightBulge(from, sc.ball, sc.arc), t0: now + held, ms: sc.ms - held,
        spin: (struck !== null ? SPIN[struck] : undefined) ?? 4,
        float: struck === 'float',
      };
    } else {
      this.flight = null;
    }
    this.actor = sc.actor;
    this.actorPose = sc.actor !== null ? sc.poses.get(sc.actor) ?? null : null;
    if (sc.point !== null && sc.point !== undefined) this.point = { team: sc.point, at: now + sc.ms, out: sc.out === true, big: sc.big === true };
    for (const [p, pose] of sc.poses) {
      if (pose !== 'hold') continue;
      // Ball in the server's hands: the serve gets waved on shortly.
      this.serveTeam = this.teamOf(p);
      if (this.needServe && this.serveDue === null) this.serveDue = now + 450 / this.pace;
    }
    if (this.actorPose === 'serve' || this.actorPose === 'float') {
      // A point still unsignalled is history by the next serve.
      this.calls = this.calls.filter((c) => c.kind !== 'point');
      // Tossed already: if the whistle hasn't gone, it goes now.
      if (this.needServe && sc.actor !== null) this.whistle({ kind: 'serve', team: this.teamOf(sc.actor), out: false }, now);
      this.live = true;
    }

    const sideOf = (p: number): number => this.sides[this.teamOf(p)];
    for (const [p, g] of sc.positions) {
      const pose = sc.poses.get(p) ?? 'stand';
      let b = this.bodies.get(p);
      if (b === undefined) {
        b = this.spawn(p, g.x, g.y, pose);
        this.bodies.set(p, b);
      }
      // Coming on from the warm-up area: through the substitution zone.
      if (b.side === 'bench' && !this.first) b.via = { x: SIDELINE.sub.x, y: sideOf(p) * SIDELINE.sub.in };
      b.side = null;
      b.home = null;
      b.tx = g.x;
      b.ty = g.y;
      b.leaving = false;
      const continuing = pose === 'block' && b.action?.kind === 'block' && now < b.action.tc + 700;
      if (!continuing) {
        b.ox = 0;
        b.oy = 0;
      }
      b.pose = pose;
      if (CONTACTS.has(pose) && !continuing) this.startContact(b, p, pose, sc, now);
      if (pose === 'hold' && sc.ball !== null) {
        // The ball sits in the server's hands, held out in front.
        const yaw = netYaw(g.y);
        const h = reach(HOLD, b.hand, 'both', b.scale);
        const o = toCourt(yaw, h[0], h[1]);
        b.ox = sc.ball.x - o.x - g.x;
        b.oy = sc.ball.y - o.y - g.y;
      }
      if (this.first) {
        b.x = b.tx + b.ox;
        b.y = b.ty + b.oy;
      }
    }
    const spots = this.sideSpots();
    for (const [p, b] of this.bodies) {
      if (sc.positions.has(p)) continue;
      b.ox = 0;
      b.oy = 0;
      b.pose = 'stand';
      const spot = spots.get(p);
      if (spot === undefined) {
        // Gone from the match: off to the nearer sideline.
        b.leaving = true;
        b.tx = Math.sign(b.x || 1) * 6.3;
        continue;
      }
      // Off the court: a substitute through the zone to the warm-up area, a libero's man to the bench.
      if (b.side === null && spot.kind === 'bench') b.via = { x: SIDELINE.sub.x, y: sideOf(p) * SIDELINE.sub.out };
      b.side = spot.kind;
      b.home = { x: spot.x, y: spot.y };
      b.tx = spot.x;
      b.ty = spot.y;
      b.leaving = false;
    }
    this.onCourt = new Set(sc.positions.keys());
    this.first = false;
  }

  private spawn(p: number, x: number, y: number, pose: Pose): Body {
    const f = this.figure(p);
    // Players coming on mid-match (a substitution) walk on from the sideline.
    const startX = this.first ? x : Math.sign(x || 1) * 6.1;
    const posture = postureOf(pose);
    return {
      x: startX, y, tx: x, ty: y, ox: 0, oy: 0, vx: 0, vy: 0, yaw: netYaw(y), lift: 0, vz: 0,
      pose, posture, shape: posture, gait: 0, running: 0, action: null, reaction: null, fade: null,
      alpha: this.first ? 1 : 0, leaving: false,
      scale: Math.min(1.12, Math.max(0.85, f.height / REF_HEIGHT)), hand: f.hand, seed: p,
      rig: buildRig(posture, { ...STILL, hand: f.hand }), side: null, via: null, home: null,
    };
  }

  /** Stand where the hand (or both hands) at `contact` shape will be on the ball. */
  private placeFor(b: Body, contact: Ball3, yaw: number, s: Shape, which: 'hit' | 'both'): V3 {
    const h = reach(s, b.hand, which, b.scale);
    const o = toCourt(yaw, h[0], h[1]);
    b.ox = contact.x - o.x - b.tx;
    b.oy = contact.y - o.y - b.ty;
    return h;
  }

  private startContact(b: Body, p: number, pose: Pose, sc: Scene, now: number): void {
    const pre = Math.max(120, sc.ms);
    const tc = now + sc.ms;
    const isActor = sc.actor === p;
    const ball = isActor ? sc.ball : null;
    const aim = isActor ? sc.aim ?? null : null;
    const net = netYaw(b.ty);
    const towardsAim = aim !== null ? clampYaw(yawTo(aim.x - b.tx, aim.y - b.ty), net, 0.9) : net;
    const incoming = this.flight !== null ? yawTo(this.flight.from.x - this.flight.to.x, this.flight.from.y - this.flight.to.y) : net;
    const act = (kind: ActionKind, keys: Key[], end: number, yaw: number | null, jump: Jump | null = null, path: Path | null = null): void => {
      if (b.action !== null) b.fade = { from: b.shape, t0: now };
      b.action = { kind, t0: now, tc, keys, jump, yaw, path, end };
    };

    switch (pose) {
      case 'spike':
      case 'serve': {
        const serving = pose === 'serve';
        const yaw = serving ? clampYaw(towardsAim, net, 0.5) : towardsAim;
        let h = 0.7;
        if (ball !== null) {
          const hand = this.placeFor(b, ball, yaw, STRIKE, 'hit');
          h = Math.min(serving ? 0.85 : 1.0, Math.max(0.25, ball.z - hand[2]));
        }
        const T = hangTime(h, pre * (serving ? 0.4 : 0.5));
        const keys = timeline(pre, [
          [-pre, serving ? HOLD : APPROACH],
          // A jump server throws the ball up at once — early, high and forward.
          ...(serving ? [[-pre + Math.min(160, pre * 0.15), TOSS] as [number, Shape]] : []),
          // Arms thrown back only over the last two steps.
          [-T - 320, APPROACH], [-T - 110, LOAD], [-T, TAKEOFF], [-T * 0.45, COCKED], [0, STRIKE, 'whip'], [120, FOLLOW],
          [T + 30, LAND], [T + 430, READY],
        ]);
        // A server runs in from where they tossed the ball out of their hands.
        const toss = this.flight?.from;
        const hold = reach(HOLD, b.hand, 'both', b.scale);
        const back = toCourt(net, hold[0], hold[1]);
        const start = serving && toss !== undefined ? { x: toss.x - back.x, y: toss.y - back.y } : { x: b.x, y: b.y };
        const path = runUp(b, serving ? Math.max(-pre * 0.65, -T - 400) : -pre, T, 0.18, start);
        act(pose, keys, T + 540, yaw, { up: -T, peak: 0, down: T, h }, path);
        break;
      }
      case 'float': {
        const yaw = clampYaw(towardsAim, net, 0.5);
        let h = 0;
        if (ball !== null) {
          const hand = this.placeFor(b, ball, yaw, FLOAT_HIT, 'hit');
          h = Math.min(0.4, Math.max(0, ball.z - hand[2]));
        }
        const T = hangTime(h, 260);
        // He holds the ball, settles, and only then tosses it — short and
        // late — lifting it with his other hand, or with both together.
        const held = Math.min(sc.release ?? 0, pre * 0.8);
        const air = pre - held;
        const toss = isActor && tossesWithBothHands(p) ? FLOAT_TOSS_BOTH : FLOAT_TOSS;
        const keys = timeline(pre, [
          [-pre, HOLD], [-air - Math.min(60, held * 0.3), HOLD], [-air + air * 0.3, toss],
          [-air * 0.4, FLOAT_COCK], [0, FLOAT_HIT, 'whip'], [220, FLOAT_HOLD], [620, READY],
        ]);
        act('float', keys, 740, yaw, h > 0.08 ? { up: -T, peak: 0, down: T, h } : null);
        break;
      }
      case 'receive':
      case 'pass':
      case 'dig': {
        const dig = pose === 'dig';
        // Face the ball coming in, the platform turned a little towards where
        // it is going — well round towards the hitter for a bumped set, the
        // second touch of the side's own ball.
        const second = this.flight !== null && this.flight.from.y * this.flight.to.y > 0;
        const turn = aim !== null ? wrap(towardsAim - incoming) : 0;
        const yaw = second ? incoming + Math.max(-1.2, Math.min(1.2, turn)) * 0.75
          : incoming + Math.max(-0.35, Math.min(0.35, turn)) * 0.4;
        const [low, hit, after] = dig ? [DIG_LOW, DIG_HIT, DIG_UP] : [PLATFORM, PLATFORM_HIT, PLATFORM_HOLD];
        let drop = 0;
        if (ball !== null) {
          const hand = this.placeFor(b, ball, yaw, hit, 'both');
          // Down (or up) to the ball's height, as far as the legs go.
          drop = Math.max(-0.12, Math.min(dig ? 0.12 : 0.22, hand[2] - ball.z));
        }
        const lower = (s: Shape): Shape => ({ ...s, crouch: s.crouch + drop });
        const keys = timeline(pre, [
          [-pre, READY], [dig ? -Math.min(260, pre * 0.7) : -Math.min(450, pre * 0.55), lower(low)],
          [0, lower(hit)], [dig ? 220 : 200, after], [dig ? 650 : 560, READY],
        ]);
        act(pose, keys, dig ? 780 : 680, yaw);
        break;
      }
      case 'set': {
        // At the net, square to the left antenna — the side's own left, zone 4 —
        // and set forwards or arched back over the head. Chasing a pass well
        // off the net, face the hitter instead.
        const offNet = Math.abs(b.ty) > 1.6;
        const yaw = offNet ? towardsAim : b.ty <= 0 ? Math.PI / 2 : -Math.PI / 2;
        const back = !offNet && aim !== null && Math.cos(wrap(yawTo(aim.x - b.tx, aim.y - b.ty) - yaw)) < 0;
        let h = 0;
        if (ball !== null) {
          const hand = this.placeFor(b, ball, yaw, SET_TOUCH, 'both');
          h = Math.min(0.45, Math.max(0, ball.z - hand[2]));
        }
        const T = hangTime(h, pre * 0.45);
        const keys = timeline(pre, [
          [-pre, READY], [-Math.min(380, pre * 0.6), SET_PREP], [0, SET_TOUCH], [150, back ? BACK_SET_OUT : SET_OUT],
          [Math.max(480, T + 200), READY],
        ]);
        const jump = h > 0.08;
        act('set', keys, Math.max(600, T + 320), yaw, jump ? { up: -T, peak: 0, down: T, h } : null,
          jump ? runUp(b, -pre, T, 0) : null);
        break;
      }
      case 'block': {
        // Up just after the hitter, hands over the net at the top — as high
        // as the blocker's own hands got, when the scene knows it.
        const reachUp = reach(BLOCK_PEAK, b.hand, 'both', b.scale);
        const top = sc.blockReach ?? NET_HEIGHT + 0.52;
        const h = Math.min(0.95, Math.max(0.3, top - reachUp[2]));
        const T = hangTime(h, pre * 0.55);
        const keys = timeline(pre, [
          [-pre, BLOCK_READY], [50 - T - 130, BLOCK_LOAD], [50 - T, BLOCK_UP], [50, BLOCK_PEAK],
          [50 + T, BLOCK_LAND], [50 + T + 400, READY],
        ]);
        act('block', keys, T + 600, net, { up: 50 - T, peak: 50, down: 50 + T, h });
        break;
      }
      default:
        break;
    }
  }

  /** Which side of the net a team is playing on: -1 the near half, +1 the far. */
  private sideOf(team: 0 | 1): number {
    for (const [p, b] of this.bodies) if (!b.leaving && this.teamOf(p) === team) return Math.sign(b.ty) || -1;
    return team === 0 ? -1 : 1;
  }

  /** The referee blows and signals a call. Facing the court from the far side,
   *  their right hand is towards the near half. */
  private whistle(call: Pick<Signal, 'kind' | 'team' | 'out'>, now: number): void {
    const toNear = this.sideOf(call.team) < 0;
    const point = toNear ? POINT_H : POINT_O;
    const k = 1 / this.pace;
    const at = (list: Array<[number, Shape]>): Array<[number, Shape]> => list.map(([t, s]) => [t * k, s]);
    let keys: Array<[number, Shape]>;
    let blow: [number, number] = [130, 380];
    if (call.kind === 'serve') {
      keys = at([[130, WHISTLE], [360, WHISTLE], [560, point], [700, point], [980, toNear ? SWEEP_H : SWEEP_O],
        [1150, toNear ? SWEEP_H : SWEEP_O], [1450, REF_REST]]);
      blow = [130, 360];
      this.needServe = false;
      this.serveDue = null;
    } else if (call.kind === 'timeout') {
      keys = at([[130, WHISTLE], [400, WHISTLE], [620, TIME_OUT], [1300, TIME_OUT], [1500, point], [2100, point],
        [2400, REF_REST]]);
      blow = [130, 400];
    } else {
      const before: Array<[number, Shape]> = call.out ? [[560, BALL_OUT], [900, BALL_OUT]] : [];
      const lag = call.out ? 520 : 0;
      keys = at([[130, WHISTLE], [380, WHISTLE], ...before, [560 + lag, point], [1180 + lag, point], [1440 + lag, REF_REST]]);
    }
    const r = this.referee;
    const list = timeline(0, [[0, r.shape], ...keys]);
    const end = list[list.length - 1].t + 60;
    r.reaction = { kind: 'stand', t0: now, tc: now, keys: list, jump: null, yaw: null, path: null, end };
    this.signal = { ...call, t0: now, end: now + end, whistle: [now + blow[0] * k, now + blow[1] * k] };
  }

  /** Free for the next call: the last one is winding down. */
  private refereeFree(now: number): boolean {
    const r = this.referee.reaction;
    return r === null || now - r.tc > r.end - 250 / this.pace;
  }

  /** The end of a point: the winners celebrate, the losers take it in. */
  private react(now: number, winner: 0 | 1): void {
    for (const [p, b] of this.bodies) {
      if (b.leaving) continue;
      const won = this.teamOf(p) === winner;
      const style = (b.seed * 7 + 3) % 3;
      let keys: Key[];
      let jump: Jump | null = null;
      if (!won) {
        keys = timeline(0, [[0, b.shape], [320, HIPS], [1300, HIPS], [1750, STAND]]);
      } else if (style === 0) {
        keys = timeline(0, [[0, b.shape], [180, ARMS_UP], [950, ARMS_UP], [1400, STAND]]);
        jump = { up: 120, peak: 300, down: 480, h: 0.22 };
      } else if (style === 1) {
        keys = timeline(0, [[0, b.shape], [170, FIST], [380, FIST_DOWN], [600, FIST], [850, FIST_DOWN], [1350, STAND]]);
      } else {
        keys = timeline(0, [
          [0, b.shape], [150, CLAP_OPEN], [290, CLAP], [430, CLAP_OPEN], [570, CLAP], [710, CLAP_OPEN], [850, CLAP],
          [1300, STAND],
        ]);
      }
      const last = keys[keys.length - 1].t;
      b.reaction = { kind: won ? 'celebrate' : 'dejected', t0: now, tc: now, keys, jump, yaw: null, path: null, end: last + 60 };
    }
    this.coaches.forEach((c, t) => {
      const keys = t === winner
        ? timeline(0, [[0, c.shape], [160, CLAP_OPEN], [300, CLAP], [440, CLAP_OPEN], [580, CLAP], [1100, COACH_IDLE]])
        : timeline(0, [[0, c.shape], [340, HIPS], [1400, HIPS], [1900, COACH_IDLE]]);
      c.reaction = { kind: t === winner ? 'celebrate' : 'dejected', t0: now, tc: now, keys, jump: null, yaw: null, path: null,
        end: keys[keys.length - 1].t + 60 };
    });
  }

  /** The ball, where it is now. */
  ballAt(now: number): Ball3 | null {
    return this.flight !== null ? flightAt(this.flight, now) : null;
  }

  /** Move everyone on by `dt` seconds, to the moment `now`. */
  step(dt: number, now: number): void {
    if (this.point !== null && now >= this.point.at) {
      this.react(now, this.point.team);
      this.cheer = { team: this.point.team, t0: now, big: this.point.big };
      // The ball is down: whistle, and the point to the side that won it.
      this.calls.unshift({ kind: 'point', team: this.point.team, out: this.point.out });
      this.live = false;
      this.needServe = true;
      this.serveDue = null;
      this.point = null;
    }
    if (!this.live && this.refereeFree(now)) {
      const next = this.calls.shift();
      if (next !== undefined) {
        this.whistle(next, now);
      } else if (this.needServe && this.serveDue !== null && now >= this.serveDue && this.serveTeam !== null
        && this.stoppage.timeout === null && !this.stoppage.paused) {
        this.whistle({ kind: 'serve', team: this.serveTeam, out: false }, now);
      }
    }
    if (this.signal !== null && now > this.signal.end) this.signal = null;
    const ball = this.ballAt(now);
    this.stepReferee(now, ball);
    for (const c of this.coaches) this.stepStill(c, now, ball);
    for (const [p, b] of this.bodies) {
      if (b.side === 'bench' && b.home !== null && b.via === null) this.warmUp(p, b, now);
      this.stepBody(b, dt, now, ball);
      if (b.leaving && b.alpha < 0.02) this.bodies.delete(p);
    }
    if (ball !== null) {
      this.trail.push(ball);
      if (this.trail.length > 7) this.trail.shift();
    }
  }

  /**
   * A substitute in the warm-up area: standing at his place — or, sent to
   * warm up, sprinting out and back across the square, with a jump now and
   * then.
   */
  private warmUp(p: number, b: Body, now: number): void {
    const home = b.home!;
    if (this.sideline?.warming.has(p) !== true) {
      b.tx = home.x;
      b.ty = home.y;
      return;
    }
    const out = Math.floor(now / 1300 + (b.seed % 7) * 0.37) % 2 === 1;
    const dir = home.x < (SIDELINE.warmup.x0 + SIDELINE.warmup.x1) / 2 ? 1 : -1;
    b.tx = home.x + (out ? 0.85 * dir : 0);
    b.ty = home.y;
    if (b.reaction === null && (now + b.seed * 977) % 4600 < 34) {
      const keys = timeline(0, [[0, b.shape], [130, ARMS_UP], [520, ARMS_UP], [800, STAND]]);
      b.reaction = { kind: 'celebrate', t0: now, tc: now, keys, jump: { up: 120, peak: 330, down: 540, h: 0.42 }, yaw: null, path: null, end: 860 };
    }
  }

  /** Someone who stays put — a coach at his bench — following the ball with his eyes, and reacting to the points. */
  private stepStill(r: Body, now: number, ball: Ball3 | null): void {
    if (r.reaction !== null && now - r.reaction.tc > r.reaction.end) r.reaction = null;
    let s = r.posture;
    if (r.reaction !== null) s = mixShape(s, sample(r.reaction.keys, now - r.reaction.tc), weight(r.reaction, now));
    r.shape = s;
    let lookYaw = 0;
    let lookPitch = 0;
    if (ball !== null) {
      const dx = ball.x - r.x;
      const dy = ball.y - r.y;
      lookYaw = Math.max(-1.2, Math.min(1.2, wrap(yawTo(dx, dy) - r.yaw)));
      lookPitch = 0.4 * Math.atan2(ball.z - 1.7, Math.max(0.5, Math.hypot(dx, dy)));
    }
    r.rig = buildRig(s, { ...STILL, lookYaw, lookPitch });
  }

  /** The referee stays put on the stand, following the ball with their eyes
   *  between signals. */
  private stepReferee(now: number, ball: Ball3 | null): void {
    const r = this.referee;
    if (r.reaction !== null && now - r.reaction.tc > r.reaction.end) r.reaction = null;
    let s = r.posture;
    if (r.reaction !== null) s = mixShape(s, sample(r.reaction.keys, now - r.reaction.tc), weight(r.reaction, now));
    r.shape = s;
    let lookYaw = 0;
    let lookPitch = 0;
    if (ball !== null) {
      const dx = ball.x - r.x;
      const dy = ball.y - r.y;
      lookYaw = wrap(yawTo(dx, dy) - r.yaw);
      lookPitch = 0.5 * Math.atan2(ball.z - r.lift - 1.7, Math.max(0.5, Math.hypot(dx, dy)));
    }
    r.rig = buildRig(s, { ...STILL, lookYaw, lookPitch });
  }

  private stepBody(b: Body, dt: number, now: number, ball: Ball3 | null): void {
    const a = b.action;
    if (a !== null && now - a.tc > a.end) b.action = null;
    if (b.reaction !== null && now - b.reaction.tc > b.reaction.end) b.reaction = null;
    const action = b.action;
    const rel = action !== null ? now - action.tc : 0;

    // ---- Where the feet go ----
    const px = b.x;
    const py = b.y;
    const path = action?.path ?? null;
    if (path !== null && rel >= path.go && rel <= path.down) {
      if (!path.started) {
        path.started = true;
        path.from = { x: b.x, y: b.y };
      }
      if (rel < path.up) {
        // Accelerating in, braking into the plant.
        const e = smooth((rel - path.go) / Math.max(1, path.up - path.go));
        b.x = path.from.x + (path.plant.x - path.from.x) * e;
        b.y = path.from.y + (path.plant.y - path.from.y) * e;
      } else {
        const u = (rel - path.up) / Math.max(1, path.down - path.up);
        b.x = path.plant.x + (path.land.x - path.plant.x) * u;
        b.y = path.plant.y + (path.land.y - path.plant.y) * u;
      }
      if (rel > path.up) {
        // Once in the air the mark is wherever they come down.
        b.ox = path.land.x - b.tx;
        b.oy = path.land.y - b.ty;
      }
    } else {
      const waiting = path !== null && rel < path.go;
      if (b.via !== null && Math.hypot(b.via.x - b.x, b.via.y - b.y) < 0.3) {
        // At the substitution zone: a slap of hands, and on.
        b.via = null;
        const keys = timeline(0, [[0, b.shape], [140, SLAP], [380, SLAP], [620, b.posture]]);
        b.reaction = { kind: 'celebrate', t0: now, tc: now, keys, jump: null, yaw: null, path: null, end: 680 };
      }
      const goalX = b.via !== null ? b.via.x : b.tx + b.ox;
      const goalY = b.via !== null ? b.via.y : b.ty + b.oy;
      const dx = (waiting ? path.from.x : goalX) - b.x;
      const dy = (waiting ? path.from.y : goalY) - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.001 && b.lift < 0.05) {
        const move = Math.min(dist, Math.min(MAX_SPEED, dist / SETTLE) * dt);
        b.x += (dx / dist) * move;
        b.y += (dy / dist) * move;
      }
    }
    const k = 1 - Math.exp(-dt / 0.08);
    if (dt > 0) {
      b.vx += ((b.x - px) / dt - b.vx) * k;
      b.vy += ((b.y - py) / dt - b.vy) * k;
    }
    const speed = Math.hypot(b.vx, b.vy);

    // ---- Which way they face ----
    const net = netYaw(b.ty);
    const remaining = Math.hypot(b.tx + b.ox - b.x, b.ty + b.oy - b.y);
    let face: number;
    if (action !== null && action.yaw !== null && rel > -Math.max(350, (action.tc - action.t0) * 0.6)) face = action.yaw;
    else if ((speed > 2.6 && remaining > 1.5) || (b.via !== null && speed > 0.8)) face = yawTo(b.vx, b.vy);
    else if (b.side !== null) face = yawTo(-b.x, -b.y * 0.5);
    else if (ball !== null && b.pose !== 'stand' && b.pose !== 'hold') face = clampYaw(yawTo(ball.x - b.x, ball.y - b.y), net, 1.2);
    else face = net;
    const turn = wrap(face - b.yaw);
    b.yaw = wrap(b.yaw + Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, turn * (1 - Math.exp(-dt / 0.06)))));

    // ---- Off the floor ----
    const jumpNow = action !== null && action.jump !== null ? liftAt(action.jump, rel) : 0;
    const r = b.reaction;
    const hop = r !== null && r.jump !== null ? liftAt(r.jump, now - r.tc) * Math.max(0, 1 - speed / 2.5) : 0;
    const lift = Math.max(jumpNow, hop);
    if (lift > 0) {
      b.lift = lift;
      b.vz = 0;
    } else if (b.lift > 0) {
      b.vz -= 9.81 * dt;
      b.lift = Math.max(0, b.lift + b.vz * dt);
    }

    // ---- The shape of the body ----
    const c = Math.cos(b.yaw);
    const sn = Math.sin(b.yaw);
    const moveX = b.vx * c + b.vy * sn;
    const moveY = -b.vx * sn + b.vy * c;
    b.posture = mixShape(b.posture, postureOf(b.pose), 1 - Math.exp(-dt / 0.18));
    let s = b.posture;
    // Properly on the move forwards they run tall; shuffles and backpedals stay low.
    b.running += (smooth((moveY - 1.8) / 2.2) - b.running) * (1 - Math.exp(-dt / 0.12));
    s = mixShape(s, RUN, b.running);
    // A little life while waiting: weight shifting, a bounce on the toes.
    const idle = Math.sin(now / 420 + b.seed * 1.7);
    s = { ...s, crouch: s.crouch + (b.pose === 'stand' ? 0.008 : 0.018) * idle };
    if (b.reaction !== null) s = mixShape(s, sample(b.reaction.keys, now - b.reaction.tc), weight(b.reaction, now));
    if (action !== null) s = mixShape(s, sample(action.keys, rel), weight(action, now));
    if (b.fade !== null) {
      const u = (now - b.fade.t0) / 140;
      if (u >= 1) b.fade = null;
      else s = mixShape(b.fade.from, s, smooth(u));
    }
    b.shape = s;

    // ---- Running, and looking at the ball ----
    b.gait += (Math.PI * speed * dt) / strideLength(speed);
    let lookYaw = 0;
    let lookPitch = 0;
    if (ball !== null) {
      const dx = ball.x - b.x;
      const dy = ball.y - b.y;
      lookYaw = wrap(yawTo(dx, dy) - b.yaw);
      lookPitch = 0.45 * Math.atan2(ball.z - 1.7 * b.scale - b.lift, Math.max(0.5, Math.hypot(dx, dy)));
    }
    const airborne = Math.min(1, b.lift / 0.06);
    b.rig = buildRig(s, { hand: b.hand, gait: b.gait, moveX, moveY, airborne, lookYaw, lookPitch });

    const alphaTarget = b.leaving ? 0 : 1;
    b.alpha += (alphaTarget - b.alpha) * (1 - Math.exp(-dt / 0.25));
  }
}

/** How much a move is showing: easing in from its start, out towards its end. */
function weight(a: Action, now: number): number {
  const into = Math.min(160, (a.tc - a.t0) * 0.35);
  const wIn = into <= 0 ? 1 : smooth((now - a.t0) / into);
  const rel = now - a.tc;
  const wOut = 1 - smooth((rel - (a.end - 280)) / 280);
  return Math.min(wIn, wOut);
}
