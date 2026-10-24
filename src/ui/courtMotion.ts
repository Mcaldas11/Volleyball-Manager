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
 * Moves flow into one another as a body's do: the keys of a move are joined
 * by one smooth curve rather than stopped at, players speed up and brake
 * rather than starting and stopping dead, turn with a swing, and every part
 * of the body carries its momentum through a move cut short or begun anew.
 * When the ball lands, the side that won the point celebrates and the other
 * lets it sink in. A final won, the winners gather in front of the cameras
 * and their captain lifts the trophy (trophyLift).
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
  ballAlong, COURT_HALF_LENGTH, flightBulge, NET_HEIGHT, tossesWithBothHands, type Ball3, type Pose, type Scene,
} from './matchCourt.ts';
import {
  arms, buildRig, COVER, HOLD, jointPositions, mixShape, READY, REF_HEIGHT, shape, SHAPE_KEYS, STAND, STILL, strideLength,
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
/** A tip: the arm up as for the hit, then the fingers push the ball over the block instead. */
const TIP_COCK = shape(COCKED, { twist: 0.25, hFlex: 2.95, hAbd: 0.45, hElbow: 1.2 });
const TIP_HIT = shape(STRIKE, { lean: 0.02, twist: -0.05, bend: -0.05, hFlex: 2.95, hAbd: 0.2, hElbow: 0.3 });
const TIP_HOLD = shape(TIP_HIT, { lean: 0.12, hFlex: 2.6, hElbow: 0.45, oFlex: 1.2 });
/** A roll shot: the full swing, slowed, the hand rolling up and over the ball. */
const ROLL_HIT = shape(STRIKE, { lean: 0.04, twist: -0.15, hFlex: 2.9, hElbow: 0.22 });
const ROLL_OVER = shape(FOLLOW, { lean: 0.28, twist: -0.25, hFlex: 1.7, hAbd: 0, hElbow: 0.5 });
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

/** Launched full length at a ball out of reach: long and low, both arms out for it. */
const DIVE_REACH = shape(DIG_LOW, {
  crouch: 0.2, hipShift: 0.04, tilt: 0.18, lean: 0.16, dive: 0.9, nod: -1.05, stance: 0.14, stride: 0.5,
  ...arms(1.5, -0.2, 0.04),
});
/** The ball on the forearms at full stretch. */
const DIVE_HIT = shape(DIVE_REACH, { dive: 1.05, crouch: 0.12, ...arms(1.62, -0.22, 0.03) });
/** Down on the floor chest first, the arms still out past the head: the pancake. */
const DIVE_FLAT = shape(STAND, {
  crouch: 0, hipShift: 0, tilt: 0.02, lean: 0.04, dive: 1.47, nod: -0.85, stance: 0.17, stride: 0.04, tuck: 0, point: 0,
  hFlex: 2.7, hAbd: 0.32, hElbow: 0.25, oFlex: 2.85, oAbd: 0.22, oElbow: 0.15,
});
/** Pushing back up: hands under the shoulders, a knee drawn up under the body. */
const DIVE_PUSH = shape(STAND, {
  crouch: 0.5, hipShift: -0.04, tilt: 0.55, lean: 0.6, dive: 0.72, nod: -0.35, stance: 0.22, stride: 0.48,
  ...arms(1.15, 0.36, 0.35),
});
/** Over sideways after a ball wide of him: the leg out, down on the hip, the arms reaching for it. */
const SPRAWL_REACH = shape(DIG_LOW, {
  crouch: 0.36, tilt: 0.3, lean: 0.24, roll: 0.62, dive: 0.12, stance: 0.5, stride: 0.16, nod: -0.7,
  ...arms(1.75, -0.12, 0.05),
});
const SPRAWL_HIT = shape(SPRAWL_REACH, { roll: 0.82, ...arms(1.9, -0.12, 0.04) });
const SPRAWL_FLAT = shape(STAND, {
  crouch: 0.16, tilt: 0.12, lean: 0.16, roll: 1.32, dive: 0.08, nod: -0.45, stance: 0.42, stride: 0.12,
  hFlex: 2.35, hAbd: 0.25, hElbow: 0.35, oFlex: 2.1, oAbd: 0.3, oElbow: 0.5,
});
const SPRAWL_UP = shape(STAND, {
  crouch: 0.5, tilt: 0.45, lean: 0.45, roll: 0.55, dive: 0.2, nod: -0.3, stance: 0.34, stride: 0.3,
  ...arms(0.9, 0.4, 0.6),
});

/** A sideways shape tipped over towards `side`: +1 his right, -1 his left. */
function sideways(s: Shape, side: number): Shape {
  return side >= 0 ? s : { ...s, roll: -s.roll };
}

/** How far off their feet a shape has someone: 0 standing, 1 and more flat out. */
function grounded(s: Shape): number {
  return Math.max(Math.abs(s.dive), Math.abs(s.roll));
}

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
/** A coach at a time-out, making his point: one hand out, then the other. */
const TALK_A = shape(STAND, { lean: 0.08, nod: 0.05, hFlex: 1.25, hAbd: 0.25, hElbow: 1.0, oFlex: 0.35, oAbd: 0.2, oElbow: 1.2 });
const TALK_B = shape(STAND, { lean: 0.1, nod: 0.12, hFlex: 0.45, hAbd: 0.2, hElbow: 1.3, oFlex: 1.35, oAbd: 0.15, oElbow: 0.8 });
/** Listening to the coach at a time-out: hands on hips, or on the knees. */
const LISTEN = shape(STAND, { crouch: 0.04, lean: 0.1, nod: 0.18, stance: 0.18, ...arms(-0.2, 0.5, 1.8, 0.5) });
const LISTEN_LOW = shape(STAND, { crouch: 0.16, hipShift: -0.05, tilt: 0.4, lean: 0.5, nod: 0.15, stance: 0.22, ...arms(0.62, 0.2, 0.2) });
/** A wave to the crowd before the match. */
const WAVE = shape(STAND, { nod: -0.15, hFlex: 2.7, hAbd: 0.55, hElbow: 0.5, oFlex: 0.2, oAbd: 0.2, oElbow: 0.4 });
const WAVE_OUT = shape(WAVE, { hAbd: 0.95, hElbow: 0.35 });
/** One hand up for a slap as a substitute comes on. */
const SLAP = shape(STAND, { lean: 0.05, nod: -0.1, hFlex: 2.6, hAbd: 0.35, hElbow: 0.35, oFlex: 0.3, oAbd: 0.25, oElbow: 0.6 });
const FIST = shape(STAND, { crouch: 0.06, lean: -0.1, nod: -0.25, hFlex: 1.75, hAbd: 0.35, hElbow: 2.3, oFlex: 0.4, oAbd: 0.3, oElbow: 1.2 });
const FIST_DOWN = shape(FIST, { crouch: 0.16, lean: 0.18, nod: 0.1, hFlex: 1.05, hElbow: 2.4 });
const CLAP_OPEN = shape(STAND, { nod: -0.1, ...arms(1.35, 0.32, 1.1) });
const CLAP = shape(CLAP_OPEN, { ...arms(1.42, -0.12, 1.0) });
/** Into the huddle: leaning in, arms out to the middle. */
const HUDDLE_IN = shape(STAND, { crouch: 0.08, tilt: 0.18, lean: 0.22, nod: 0.1, stance: 0.2, ...arms(1.55, -0.05, 0.5) });
/** Hands together up in the middle of the huddle. */
const HUDDLE_UP = shape(HUDDLE_IN, { crouch: 0.03, lean: 0.08, nod: -0.35, ...arms(2.55, 0.05, 0.25) });
/** A low five in a quiet huddle after a point lost: "next one". */
const LOW_FIVE = shape(STAND, { crouch: 0.1, tilt: 0.2, lean: 0.26, nod: 0.25, stance: 0.2, ...arms(1.0, -0.1, 0.45) });
/** The roar after a block or an ace: down in a crouch, both fists clenched. */
const ROAR = shape(STAND, {
  crouch: 0.2, hipShift: -0.04, tilt: 0.25, lean: 0.12, nod: -0.45, stance: 0.3,
  hFlex: 1.15, hAbd: 0.55, hElbow: 2.2, oFlex: 1.15, oAbd: 0.55, oElbow: 2.2,
});
/** Hands on hips, head down. */
const HIPS = shape(STAND, { lean: 0.06, nod: 0.45, ...arms(-0.25, 0.55, 1.9, 0.6) });
/** The trophy in both hands, held in front at the chest… */
const TROPHY_CARRY = shape(STAND, { nod: -0.1, ...arms(1.3, 0.02, 1.35) });
/** …and up over the head by its handles, looking up at it. */
const TROPHY_UP = shape(STAND, { lean: -0.16, nod: -0.6, ...arms(2.95, 0.02, 0.3) });
const TROPHY_HIGH = shape(TROPHY_UP, { lean: -0.22, nod: -0.7, ...arms(3.1, 0.02, 0.1) });
/** Bent over, hands on the knees: that one hurt. */
const KNEES = shape(STAND, { crouch: 0.2, hipShift: -0.06, tilt: 0.5, lean: 0.72, nod: 0.25, stance: 0.24, ...arms(0.62, 0.22, 0.2) });

/** Running flat out: tall, leaning into it, elbows bent and the arms pumping. */
/** Down hurt: on one knee, bent over, a hand on the ankle. */
const HURT = shape(STAND, {
  crouch: 0.55, hipShift: -0.06, tilt: 0.5, lean: 0.8, nod: 0.5, stance: 0.2, stride: 0.42,
  hFlex: 0.55, hAbd: 0.15, hElbow: 0.55, oFlex: 0.45, oAbd: 0.2, oElbow: 0.75,
});
/** The physio, down on his haunches beside him, hands on the leg. */
const TEND = shape(STAND, {
  crouch: 0.48, tilt: 0.35, lean: 0.55, nod: 0.4, stance: 0.26, stride: 0.3,
  hFlex: 1.05, hAbd: 0.1, hElbow: 0.65, oFlex: 0.95, oAbd: 0.1, oElbow: 0.85,
});
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

// ---- The line judges' flags -------------------------------------------------------------

/** At the corner, the flag held down by the side. */
const LJ_REST = shape(STAND, { nod: 0.12, stance: 0.14, stride: 0, hFlex: 0.08, hAbd: 0.12, hElbow: 0.08, oFlex: 0.05, oAbd: 0.12, oElbow: 0.25 });
/** Ball in: the flag pointed down at the court. */
const LJ_IN = shape(LJ_REST, { lean: 0.12, nod: 0.3, hFlex: 0.75, hAbd: -0.1, hElbow: 0.05 });
/** Ball out: the flag straight up. */
const LJ_OUT = shape(LJ_REST, { nod: -0.1, hFlex: 3.05, hAbd: 0.12, hElbow: 0.05 });
/** Ball touched: the flag up, the other hand flat on top of it. */
const LJ_TOUCH = shape(LJ_REST, { nod: -0.1, hFlex: 2.85, hAbd: 0.1, hElbow: 0.1, oFlex: 2.75, oAbd: -0.35, oElbow: 0.55 });

/**
 * Where the two line judges stand, as the FIVB places two: diagonally, at the
 * corners nearest each referee's right hand — the first referee's on the far
 * side by the near team's end, the second's on the near side by the far
 * team's — just off the corner, clear of the warm-up area. Each watches the
 * lines of his own half.
 */
export const LINE_JUDGES: ReadonlyArray<{ x: number; y: number }> = [{ x: -4.72, y: -9.55 }, { x: 5.3, y: 10.0 }];

/** What a line judge signals about where a ball came down — or nothing, well inside the court. */
export function lineCall(to: { x: number; y: number }, out: boolean): 'in' | 'out' | 'touch' | null {
  const inside = Math.abs(to.x) <= 4.5 && Math.abs(to.y) <= 9;
  if (!inside) return out ? 'out' : 'touch';
  // Near a line: the flag down for a ball in.
  const toLine = Math.min(4.5 - Math.abs(to.x), 9 - Math.abs(to.y));
  return toLine < 1.1 ? 'in' : null;
}

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
  /** How fast they were going when it began, m/s. */
  v0: { x: number; y: number };
  started: boolean;
  plant: { x: number; y: number };
  land: { x: number; y: number };
  /** Run-up start, takeoff and landing, ms from the contact. */
  go: number;
  up: number;
  down: number;
  /** Overtaken by a new scene while still under way: the jump comes down where it was going, but
   *  the new mark stands — the landing no longer decides where they go next. */
  stale?: boolean;
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

type ShapeKey = (typeof SHAPE_KEYS)[number];

/**
 * The pace, per ms, at which the curve through the keys passes key `j`, arriving (`side` -1) or
 * leaving (+1). A monotone cubic (Fritsch–Butland): never beyond a key, so a move flows on through
 * its keys rather than stopping at each, level only at its first and last and wherever it turns
 * back — and arriving at a 'whip' key at speed, carrying on through it if the next goes on the same way.
 */
function pace(keys: Key[], j: number, k: ShapeKey, side: -1 | 1): number {
  const c = keys[j];
  const p = keys[j - 1];
  const n = keys[j + 1];
  if (p === undefined) return 0;
  const h0 = c.t - p.t;
  const d0 = (c.s[k] - p.s[k]) / h0;
  if (c.ease === 'whip' && side < 0) return 2 * d0;
  if (n === undefined) return 0;
  const h1 = n.t - c.t;
  const d1 = (n.s[k] - c.s[k]) / h1;
  if (d0 * d1 <= 0) return 0;
  if (c.ease === 'whip') return Math.sign(d0) * Math.min(2 * Math.abs(d0), 3 * Math.abs(d1));
  return (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
}

function sample(keys: Key[], rel: number): Shape {
  const last = keys.length - 1;
  if (rel <= keys[0].t) return keys[0].s;
  if (rel >= keys[last].t) return keys[last].s;
  let i = 1;
  while (keys[i].t <= rel) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const h = b.t - a.t;
  const u = (rel - a.t) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = (u3 - 2 * u2 + u) * h;
  const h01 = 3 * u2 - 2 * u3;
  const h11 = (u3 - u2) * h;
  const out = { ...a.s };
  for (const k of SHAPE_KEYS) out[k] = h00 * a.s[k] + h10 * pace(keys, i - 1, k, 1) + h01 * b.s[k] + h11 * pace(keys, i, k, -1);
  return out;
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
  /** The momentum of every part of the body, kept from frame to frame — made on the first. */
  flow?: Flow;
  alpha: number;
  leaving: boolean;
  /** Size relative to the reference body. */
  scale: number;
  hand: 1 | -1;
  /** Small differences between players' idling and celebrating. */
  seed: number;
  /** Every joint's angle, this frame. */
  rig: Rig;
  /** Off the court: in the warm-up area as a substitute, by the bench to go back on, or on it hurt — null on it. */
  side: 'bench' | 'wait' | 'hurt' | null;
  /** How far down hurt, 0 to 1, and how far he is headed. */
  hurt?: number;
  hurtGoal?: number;
  /** Hobbling: off the court on a bad leg. */
  limp?: boolean;
  /** As fast as he goes, m/s, if not flat out: a walk for an official, a jog to line up. */
  pace?: number;
  /** The physio, crouched over someone: how far, 0 to 1. */
  tend?: number;
  /** After a point, or at a time-out: where in the team's huddle they go, the way they face there, and until when. */
  huddle?: Spot | null;
  /** Before the match: the places to be, one after another — warming up, lined up, at the net. */
  steps?: Spot[] | null;
  /** A point to pass through on the way to the mark: the substitution zone, on a change. */
  via: { x: number; y: number } | null;
  /** Their place by the bench, that a substitute warming up runs from and back to. */
  home: { x: number; y: number } | null;
}

/** A place a body is to be, the way it faces there, and from when until when, ms on the animation clock. */
export interface Spot {
  x: number;
  y: number;
  face: number;
  from: number;
  until: number;
}

/** Who is off the court for each side, and what they are doing. */
export interface CourtSideline {
  /** The substitutes, by side: they wait in the warm-up area. */
  bench: [number[], number[]];
  /** A libero, or the middle he has replaced, waiting by the bench to go back on. */
  waiting: [number[], number[]];
  /** Those sent to warm up. */
  warming: ReadonlySet<number>;
  /** Off hurt, out of the match: they sit by the bench. */
  hurt?: [number[], number[]];
}

/** Where a stoppage for someone hurt has got to: down, the physio with him, the coach deciding, up again or helped off. */
export type InjuryPhase = 'down' | 'treat' | 'decide' | 'up' | 'off';

/** Someone down hurt, and where the stoppage for him has got to. */
export interface CourtInjury {
  p: number;
  team: 0 | 1;
  phase: InjuryPhase;
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

/** Top running speed; how hard players can speed up and brake, and how close to their mark they
 *  ease off rather than brake; how fast they can turn. */
const MAX_SPEED = 7.5; // m/s
const ACCEL = 18; // m/s²
const BRAKE = 24; // m/s²
const SETTLE = 0.12; // s
const TURN_RATE = 10; // rad/s

/** A step bigger than this, and this much bigger than the step before, is a jump. */
const JUMP = 0.05;

/**
 * A value that follows what it is asked for with the momentum of a body. While what is asked for
 * flows, it keeps to it exactly, at its pace; where that jumps — a move cut short, another begun —
 * or changes pace at a stroke, it carries on the way it was going and catches up over about `time`
 * s: a critically damped spring on the difference (the "smooth damp" of Game Programming Gems 4).
 */
class Follow {
  x: number;
  /** Its pace, per s. */
  v = 0;
  /** What it was asked for last; how far that moved last frame, and how fast it has been flowing. */
  private aim: number;
  private moved = 0;
  private pace = 0;

  constructor(x: number) {
    this.x = x;
    this.aim = x;
  }

  /** Moves on `dt` s towards `aim`, catching up no faster than `most` per s; returns where it has got to. */
  step(aim: number, dt: number, time: number, most = Infinity): number {
    if (dt <= 0) return this.x;
    const move = aim - this.aim;
    if (dt > 0.1) {
      this.aim = aim;
      // After a stall, from where it should be.
      this.x = aim;
      this.v = 0;
      this.moved = 0;
      this.pace = 0;
      return aim;
    }
    // A jump is no pace to follow: through one, it is taken to flow on as it was. A fast move
    // gathering pace — an arm whipped through — is no jump.
    const jumped = Math.abs(move) > JUMP && Math.abs(move - this.moved) > JUMP + Math.abs(this.moved);
    const pace = Math.max(-most, Math.min(most, jumped ? this.pace : move / dt));
    // The spring works on how far off it is from what it follows, which carries on at its pace —
    // a jump left out, for the spring to take up from the next frame.
    const w = 2 / time;
    const k = w * dt;
    const e = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
    const off = Math.max(-most * time, Math.min(most * time, this.x - this.aim));
    const base = this.x - off;
    const v = this.v - pace;
    const t = (v + w * off) * dt;
    const to = base + pace * dt + (off + t) * e;
    this.x += Math.max(-most * dt, Math.min(most * dt, to - this.x));
    this.v = Math.max(-most, Math.min(most, pace + (v - w * t) * e));
    this.aim = aim;
    this.moved = move;
    this.pace = pace;
    return this.x;
  }
}

/** Everything about a body that carries momentum from one frame to the next. */
interface Flow {
  /** Each part of the shape, in SHAPE_KEYS order. */
  shape: Follow[];
  /** The way they face, unwrapped. */
  yaw: Follow;
  /** Where the head is turned to, relative to the body. */
  lookYaw: Follow;
  lookPitch: Follow;
  /** How hard they are speeding up across the floor, m/s², eased in and out as a body's weight shifts. */
  ax: Follow;
  ay: Follow;
  /** How fast they are going, in the body's frame, as the legs take it up: a first step, not a leap into stride. */
  moveX: Follow;
  moveY: Follow;
  /** Last frame's height off the floor, m, and how fast it was changing, m/s. */
  lift: number;
  liftV: number;
}

const CROUCH = SHAPE_KEYS.indexOf('crouch');

function flowOf(b: Body): Flow {
  b.flow ??= {
    shape: SHAPE_KEYS.map((k) => new Follow(b.shape[k])),
    yaw: new Follow(b.yaw),
    lookYaw: new Follow(0),
    lookPitch: new Follow(0),
    ax: new Follow(0),
    ay: new Follow(0),
    moveX: new Follow(0),
    moveY: new Follow(0),
    lift: b.lift,
    liftV: 0,
  };
  return b.flow;
}

/** The shape the body takes, asked for `aim`: each part followed with its momentum. */
function flowShape(f: Flow, aim: Shape, dt: number, time: number): Shape {
  const out = { ...aim };
  SHAPE_KEYS.forEach((k, i) => {
    out[k] = f.shape[i].step(aim[k], dt, time);
  });
  return out;
}

/** The head turned to the ball, a moment behind it as eyes and neck are. */
function lookAt(f: Flow, yaw: number, pitch: number, dt: number): [number, number] {
  return [f.lookYaw.step(yaw, dt, 0.12), f.lookPitch.step(pitch, dt, 0.12)];
}

/** How fast the ball spins off each kind of contact. */
const SPIN: Partial<Record<Pose, number>> = { spike: 32, serve: 36, float: 0.4, set: -3, receive: 6, dig: 9, pass: 5 };

const CONTACTS: ReadonlySet<Pose> = new Set<Pose>(['serve', 'float', 'receive', 'dig', 'pass', 'set', 'spike', 'block', 'dive']);

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

/** A court offset in the body frame of a player facing `yaw`: [right, ahead]. */
function toBody(yaw: number, dx: number, dy: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [dx * c + dy * s, -dx * s + dy * c];
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
    v0: { x: 0, y: 0 },
    started: false,
    plant: { x: mark.x - (dx * drift) / 2, y: mark.y - (dy * drift) / 2 },
    land: { x: mark.x + (dx * drift) / 2, y: mark.y + (dy * drift) / 2 },
    go,
    up: -up,
    down: up,
  };
}

/** The court on screen now, if one is: the match waits on its server before each serve. */
let onCourt: CourtMotion | null = null;

/** Show (or, with null, stop showing) a court — the one the match's serves wait on. */
export function showCourt(m: CourtMotion | null): void {
  onCourt = m;
}

/**
 * Whether the server on the court on screen has the ball at his spot behind the end line, and is
 * stood there — the referee waves the serve on only then. With no court on screen, nobody waits.
 */
export function serverReadyOnCourt(): boolean {
  return onCourt === null || onCourt.serverReady();
}

/** A final won: whose, from when, who lifts the cup, and where each part of it happens — see trophyLift. */
export interface TrophyLift {
  team: 0 | 1;
  t0: number;
  captain: number | null;
  /** Where they celebrate first, all together in the middle of their half. */
  huddle: { x: number; y: number };
  /** The middle of the line-up they make for the presentation… */
  at: { x: number; y: number };
  /** …the captain at its front, and the federation's man beside him with the cup. */
  front: { x: number; y: number };
  official: { x: number; y: number };
  /** When the cup goes up, ms after t0. */
  lift: number;
}

/** The ceremony's moments, ms after it begins: the federation's man walks out with the cup… */
export const TROPHY_OFFICIAL_AT = 2600;
/** …the winners leave their huddle to line up… */
export const TROPHY_GATHER_AT = 5200;
/** …the cup is handed to their captain… */
export const TROPHY_HAND_AT = 9600;
/** …and up it goes. */
export const TROPHY_LIFT_AT = 11200;

/** Where the federation's man comes out from: the corner behind the winners' end, by their bench. */
const OFFICIAL_FROM = { x: -4.6, y: 12.0 };

export class CourtMotion {
  readonly bodies = new Map<number, Body>();
  /** The trophy being lifted, once a final is won — see trophyLift. Nothing else happens on the court after it. */
  trophy: TrophyLift | null = null;
  /** The federation's man who presents it, once he has come out. */
  official: Body | null = null;
  flight: Flight | null = null;
  /** The ball's last few positions, for the streak behind a fast one. */
  trail: Ball3[] = [];
  actor: number | null = null;
  private actorPose: Pose | null = null;
  private first = true;
  private point: { team: 0 | 1; at: number; out: boolean; big: boolean; how?: Scene['how']; hero?: number } | null = null;
  /** The last point won, for the crowd: whose, when, and whether it was one to get up for. */
  cheer: Cheer | null = null;

  /** The first referee, up on the stand, facing the court. */
  readonly referee: Body;
  /** Each side's coach, at the front of its bench. */
  readonly coaches: [Body, Body];
  /** The two line judges, flags in hand. */
  readonly lineJudges: [Body, Body];
  /** The physio, on for someone hurt — null when nobody is. */
  medic: Body | null = null;
  /** Someone down hurt, and where the stoppage for him has got to. */
  private injury: CourtInjury | null = null;
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
      pose: 'stand', posture: REF_REST, shape: REF_REST, gait: 0, running: 0, action: null, reaction: null,
      alpha: 1, leaving: false, scale: 1.85 / REF_HEIGHT, hand: 1, seed: 7,
      rig: buildRig(REF_REST, STILL), side: null, via: null, home: null,
    };
    this.coaches = [this.coachBody(0, -1), this.coachBody(1, 1)];
    this.lineJudges = [this.lineJudgeBody(0), this.lineJudgeBody(1)];
  }

  /** A line judge at his corner, facing the court. */
  private lineJudgeBody(i: 0 | 1): Body {
    const at = LINE_JUDGES[i];
    return {
      x: at.x, y: at.y, tx: at.x, ty: at.y, ox: 0, oy: 0, vx: 0, vy: 0, yaw: yawTo(-at.x, -at.y * 0.4), lift: 0, vz: 0,
      pose: 'stand', posture: LJ_REST, shape: LJ_REST, gait: 0, running: 0, action: null, reaction: null,
      alpha: 1, leaving: false, scale: 1.8 / REF_HEIGHT, hand: 1, seed: 21 + i,
      rig: buildRig(LJ_REST, STILL), side: null, via: null, home: null,
    };
  }

  /** The line judge of the half a ball came down in signals it: in, out, or off a touch. */
  private flagLanding(now: number, to: { x: number; y: number }, out: boolean): void {
    const call = lineCall(to, out);
    if (call === null) return;
    const judge = this.lineJudges[to.y < 0 ? 0 : 1];
    const flag = call === 'in' ? LJ_IN : call === 'out' ? LJ_OUT : LJ_TOUCH;
    const k = 1 / this.pace;
    const keys = timeline(0, [[0, judge.shape], [180 * k, flag], [1300 * k, flag], [1650 * k, LJ_REST]]);
    judge.reaction = { kind: 'stand', t0: now, tc: now, keys, jump: null, yaw: null, path: null, end: keys[keys.length - 1].t + 60 };
    this.lastLineCall = { call, judge: to.y < 0 ? 0 : 1, at: now };
  }

  /** The last flag shown, for anyone drawing it. */
  lastLineCall: { call: 'in' | 'out' | 'touch'; judge: 0 | 1; at: number } | null = null;

  /** A coach, standing at the front of his bench and facing the court. */
  private coachBody(team: 0 | 1, side: number): Body {
    const at = coachSpot(side);
    return {
      x: at.x, y: at.y, tx: at.x, ty: at.y, ox: 0, oy: 0, vx: 0, vy: 0, yaw: yawTo(1, -side * 0.35), lift: 0, vz: 0,
      pose: 'stand', posture: COACH_IDLE, shape: COACH_IDLE, gait: 0, running: 0, action: null, reaction: null,
      alpha: 1, leaving: false, scale: 1.82 / REF_HEIGHT, hand: 1, seed: 11 + team,
      rig: buildRig(COACH_IDLE, STILL), side: null, via: null, home: null,
    };
  }

  /**
   * Who is off the court, and which half each team is on (the near team on
   * the negative one): everyone not playing goes to their place by the
   * bench, anyone new there appears at it, and the coaches stand by theirs.
   */
  setSideline(sl: CourtSideline, nearTeam: 0 | 1, now: number): void {
    if (this.trophy !== null) return;
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
  private sideSpots(): Map<number, { x: number; y: number; kind: 'bench' | 'wait' | 'hurt' }> {
    const out = new Map<number, { x: number; y: number; kind: 'bench' | 'wait' | 'hurt' }>();
    const sl = this.sideline;
    if (sl === null) return out;
    for (const t of [0, 1] as const) {
      const side = this.sides[t];
      sl.bench[t].forEach((p, i) => out.set(p, { ...warmupSpot(i, side), kind: 'bench' }));
      sl.waiting[t].forEach((p, i) => out.set(p, {
        x: SIDELINE.wait.x, y: side * (SIDELINE.wait.y + i * SIDELINE.wait.step), kind: 'wait',
      }));
      // Off hurt: along the bench, the far end from the coach.
      (sl.hurt?.[t] ?? []).forEach((p, i) => out.set(p, {
        x: SIDELINE.bench.x + 0.35, y: side * (SIDELINE.bench.y1 - 0.4 - i * 0.7), kind: 'hurt',
      }));
    }
    return out;
  }

  /**
   * Someone hurt: he goes down where he is, and the physio comes on from his
   * bench and down beside him. Then he is up again and back to his place —
   * or helped off on a bad leg, the physio with him, to sit by the bench.
   * Null: the stoppage is over, and the physio goes back.
   */
  setInjury(next: CourtInjury | null, now: number): void {
    if (this.trophy !== null) return;
    const prev = this.injury;
    this.injury = next;
    if (next === null) {
      if (this.medic !== null && prev !== null) {
        const home = coachSpot(this.sides[prev.team]);
        this.medic.tx = home.x - 0.5;
        this.medic.ty = home.y + this.sides[prev.team] * 0.7;
        this.medic.tend = 0;
      }
      return;
    }
    const b = this.bodies.get(next.p);
    if (b !== undefined) {
      b.hurtGoal = next.phase === 'up' ? 0 : next.phase === 'off' ? 0.25 : 1;
      b.action = null;
      b.reaction = null;
      if (next.phase === 'off') {
        // Helped off: by the substitution zone to the bench.
        const side = this.sides[next.team];
        b.limp = true;
        b.via = { x: SIDELINE.sub.x, y: side * SIDELINE.sub.out };
        b.tx = SIDELINE.bench.x + 0.35;
        b.ty = side * (SIDELINE.bench.y1 - 0.4);
        b.ox = 0;
        b.oy = 0;
        b.pose = 'stand';
      }
    }
    if (this.medic === null || this.medic.leaving) this.medic = this.medicBody(next.team);
    void now;
  }

  /** The physio, at the front of a team's bench. */
  private medicBody(team: 0 | 1): Body {
    const side = this.sides[team];
    const at = coachSpot(side);
    const x = at.x - 0.5;
    const y = at.y + side * 0.7;
    return {
      x, y, tx: x, ty: y, ox: 0, oy: 0, vx: 0, vy: 0, yaw: yawTo(1, 0), lift: 0, vz: 0,
      pose: 'stand', posture: STAND, shape: STAND, gait: 0, running: 0, action: null, reaction: null,
      alpha: 1, leaving: false, scale: 1.8 / REF_HEIGHT, hand: 1, seed: 23 + team,
      rig: buildRig(STAND, STILL), side: null, via: null, home: null, tend: 0,
    };
  }

  /** The physio's walk: out to the man down, beside him while he is treated, off with him or back alone. */
  private stepMedic(dt: number, now: number): void {
    const m = this.medic;
    if (m === null) return;
    const inj = this.injury;
    const b = inj !== null ? this.bodies.get(inj.p) : undefined;
    if (inj !== null && b !== undefined) {
      // Beside him, on the bench side; helping him off, just ahead of him.
      const side = this.sides[inj.team];
      m.tx = b.x - 0.6;
      m.ty = b.y - side * 0.2;
      const close = Math.hypot(m.tx - m.x, m.ty - m.y) < 0.35;
      const tending = (inj.phase === 'treat' || inj.phase === 'decide') && close;
      m.tend = (m.tend ?? 0) + ((tending ? 1 : 0) - (m.tend ?? 0)) * (1 - Math.exp(-dt / 0.3));
    } else if (inj === null && !m.leaving && Math.hypot(m.tx - m.x, m.ty - m.y) < 0.3) {
      m.leaving = true;
    }
    this.stepBody(m, dt, now, null);
    if (m.leaving && m.alpha < 0.02) this.medic = null;
  }

  /** Play stopped or not, and a time-out called: the referee signals the
   *  time-out once the rally in play is over, and waves no serve on until
   *  play is back on — and then waves it on again, even if it had been. */
  setStoppage(timeout: 0 | 1 | null, paused: boolean, now: number): void {
    if (this.trophy !== null) return;
    if (timeout !== null && timeout !== this.stoppage.timeout) {
      this.calls.push({ kind: 'timeout', team: timeout, out: false });
      this.timeoutHuddles(now);
    }
    if (timeout === null && this.stoppage.timeout !== null) this.breakHuddles(now);
    const stopped = timeout !== null || paused;
    const was = this.stoppage.timeout !== null || this.stoppage.paused;
    if (stopped && !this.live) {
      this.needServe = true;
      this.serveDue = null;
    }
    if (!stopped && was && this.needServe) this.serveDue = now + 300 / this.pace;
    this.stoppage = { timeout, paused };
  }

  /**
   * A time-out: both sides go to their benches and stand round their coach in a half-circle, he
   * in front of them making his point, they listening — hands on hips, or on the knees.
   */
  private timeoutHuddles(now: number): void {
    for (const team of [0, 1] as const) {
      const side = this.sides[team];
      const coach = coachSpot(side);
      const six = [...this.bodies].filter(([p, b]) => !b.leaving && b.side === null && this.onCourt.has(p) && this.teamOf(p) === team);
      // Round the half-circle in the order they come, so nobody crosses anybody.
      six.sort((a, b) => a[1].y - b[1].y);
      six.forEach(([, b], i) => {
        const a = (-0.95 + (1.9 * (i + 0.5)) / six.length) * side;
        const x = coach.x + Math.cos(a) * 1.45;
        const y = coach.y + Math.sin(a) * 1.45;
        b.huddle = { x, y, face: yawTo(coach.x - x, coach.y - y), from: now + 150 + i * 60, until: now + 120_000 };
        const low = (b.seed * 5 + i) % 3 === 0;
        b.reaction = {
          kind: 'stand', t0: now, tc: now, keys: timeline(0, [[0, b.shape], [700, READY], [1600, low ? LISTEN_LOW : LISTEN]]),
          jump: null, yaw: null, path: null, end: 120_000,
        };
      });
      const c = this.coaches[team];
      const keys: Array<[number, Shape]> = [[0, c.shape], [500, TALK_A]];
      for (let t = 1300; t < 60_000; t += 800) keys.push([t, (t / 800) % 2 < 1 ? TALK_B : TALK_A]);
      c.reaction = { kind: 'stand', t0: now, tc: now, keys: timeline(0, keys), jump: null, yaw: null, path: null, end: 60_000 };
    }
  }

  /** Play back on: the huddles break up and everyone goes back to their places. */
  private breakHuddles(now: number): void {
    for (const b of this.bodies.values()) {
      if (b.huddle == null) continue;
      b.huddle = null;
      if (b.reaction?.kind === 'stand') {
        b.reaction = { kind: 'stand', t0: now, tc: now, keys: timeline(0, [[0, b.shape], [500, READY]]), jump: null, yaw: null, path: null, end: 560 };
      }
    }
    for (const c of this.coaches) {
      if (c.reaction?.kind === 'stand') {
        c.reaction = { kind: 'stand', t0: now, tc: now, keys: timeline(0, [[0, c.shape], [600, COACH_IDLE]]), jump: null, yaw: null, path: null, end: 660 };
      }
    }
  }

  /**
   * Before the first serve: a last warm-up — a few strides about their own half — then each side
   * lines up along its attack line and waves to the crowd, comes to the net and slaps hands with
   * the side across it, and goes to its places for the serve. About six and a half seconds.
   */
  ceremony(now: number): void {
    if (this.trophy !== null) return;
    for (const team of [0, 1] as const) {
      const side = this.sides[team];
      const six = [...this.bodies].filter(([p, b]) => !b.leaving && b.side === null && this.onCourt.has(p) && this.teamOf(p) === team);
      six.sort((a, b) => a[1].x - b[1].x);
      const n = six.length;
      six.forEach(([p, b], i) => {
        const r = (k: number): number => ((p * 9301 + k * 49297) % 233280) / 233280;
        const across = n > 1 ? -2.6 + (5.2 * i) / (n - 1) : 0;
        const face = netYaw(side * 3);
        b.steps = [
          { x: -3.6 + r(1) * 7.2, y: side * (2 + r(2) * 6), face: yawTo(0, -side), from: now, until: now + 1000 },
          { x: -3.6 + r(3) * 7.2, y: side * (2 + r(4) * 6), face: yawTo(0, -side), from: now + 1000, until: now + 2000 },
          { x: across, y: side * 3.2, face, from: now + 2000, until: now + 4100 },
          { x: across * 0.85, y: side * 0.5, face, from: now + 4100, until: now + 5700 },
        ];
        b.reaction = {
          kind: 'stand', t0: now, tc: now,
          keys: timeline(0, [
            [0, b.shape], [300, READY], [1900, READY], [2500, STAND], [2900, WAVE], [3200, WAVE_OUT], [3500, WAVE], [3800, WAVE_OUT],
            [4200, STAND], [4900, SLAP], [5300, SLAP], [5700, READY],
          ]),
          jump: null, yaw: null, path: null, end: 5760,
        };
      });
    }
  }

  /**
   * Whether the server, ball in hand, is behind the end line and stood still — no serve is tossed
   * from inside the court. Nobody holding the ball: nothing to wait on.
   */
  serverReady(): boolean {
    for (const b of this.bodies.values()) {
      if (b.pose !== 'hold' || b.leaving || b.side !== null) continue;
      // Behind the line by his spot — a stride's grace short of it is near enough to stop at.
      const behind = Math.abs(b.y) >= Math.min(COURT_HALF_LENGTH + 0.3, Math.abs(b.ty) - 0.2);
      return behind && Math.hypot(b.vx, b.vy) < 1.2;
    }
    return true;
  }

  /** Hand over a new scene: new marks, postures and contacts, and a new flight. */
  scene(sc: Scene, now: number): void {
    if (this.trophy !== null) return;
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
    if (sc.point !== null && sc.point !== undefined) {
      this.point = { team: sc.point, at: now + sc.ms, out: sc.out === true, big: sc.big === true, how: sc.how, hero: sc.hero };
    }
    // Play goes on: the huddles break up.
    for (const b of this.bodies.values()) b.huddle = null;
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
        // A jump still in the air comes down, but the new mark stands: a hitter who has just put
        // the point away and is to serve next goes to the end line, not back to where he landed.
        if (b.action?.path != null) b.action.path.stale = true;
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
      if (b.side === null && (spot.kind === 'bench' || spot.kind === 'hurt') && b.via === null) {
        b.via = { x: SIDELINE.sub.x, y: sideOf(p) * SIDELINE.sub.out };
      }
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
      pose, posture, shape: posture, gait: 0, running: 0, action: null, reaction: null,
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
      b.action = { kind, t0: now, tc, keys, jump, yaw, path, end };
    };

    switch (pose) {
      case 'spike':
      case 'serve': {
        const serving = pose === 'serve';
        const yaw = serving ? clampYaw(towardsAim, net, 0.5) : towardsAim;
        let h = 0.7;
        if (ball !== null) {
          const hand = this.placeFor(b, ball, yaw, !serving && sc.shot === 'tip' ? TIP_HIT : !serving && sc.shot === 'roll' ? ROLL_HIT : STRIKE, 'hit');
          h = Math.min(serving ? 0.85 : 1.0, Math.max(0.25, ball.z - hand[2]));
        }
        const T = hangTime(h, pre * (serving ? 0.4 : 0.5));
        // A tip or a roll shot: the same run and jump, a different arm.
        const soft = !serving ? sc.shot : undefined;
        const [cock, hit, after, ease]: [Shape, Shape, Shape, Ease] = soft === 'tip'
          ? [TIP_COCK, TIP_HIT, TIP_HOLD, 'smooth']
          : soft === 'roll' ? [COCKED, ROLL_HIT, ROLL_OVER, 'smooth'] : [COCKED, STRIKE, FOLLOW, 'whip'];
        const keys = timeline(pre, [
          [-pre, serving ? HOLD : APPROACH],
          // A jump server throws the ball up at once — early, high and forward.
          ...(serving ? [[-pre + Math.min(160, pre * 0.15), TOSS] as [number, Shape]] : []),
          // Arms thrown back only over the last two steps, and swung up through the plant.
          [-T - 380, APPROACH], [-T - 160, LOAD], [-T, TAKEOFF], [-T * 0.45, cock], [0, hit, ease], [soft === undefined ? 120 : 200, after],
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
          // A ball near the floor, or more ground than the legs can make in
          // time: he goes full length for it.
          const travel = Math.hypot(b.tx + b.ox - b.x, b.ty + b.oy - b.y);
          if (dig && (ball.z < 0.36 || travel > 0.8 + (2.6 * pre) / 1000)) {
            this.diveFor(b, ball, pre, now, tc, true);
            break;
          }
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
      case 'dive': {
        // A ball he can't get to: he goes full length for it anyway, and it
        // is down past his hands.
        if (sc.ball !== null) this.diveFor(b, sc.ball, pre, now, tc, false);
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

  /**
   * Full length for a ball: forward and flat out on the chest for one in
   * front of him, over sideways on the hip for one wide; the hands meeting
   * it at the stretch if he `gets` there, falling just short if not. Then a
   * moment on the floor, and back up.
   */
  private diveFor(b: Body, ball: Ball3, pre: number, now: number, tc: number, gets: boolean): void {
    const dx = ball.x - b.x;
    const dy = ball.y - b.y;
    const [right, ahead] = toBody(b.yaw, dx, dy);
    const wide = Math.abs(right) > Math.abs(ahead) * 1.1 + 0.25;
    const side = Math.sign(right) || 1;
    // Forwards he turns to the ball; sideways he keeps facing the play.
    const yaw = wide ? b.yaw : yawTo(dx, dy);
    const [reachShape, hitShape, flat, up] = wide
      ? [sideways(SPRAWL_REACH, side), sideways(SPRAWL_HIT, side), sideways(SPRAWL_FLAT, side), sideways(SPRAWL_UP, side)]
      : [DIVE_REACH, DIVE_HIT, DIVE_FLAT, DIVE_PUSH];
    if (gets) {
      this.placeFor(b, ball, yaw, hitShape, 'both');
    } else {
      // As far towards it as he can push off from, the hands landing short of it.
      const h = reach(hitShape, b.hand, 'both', b.scale);
      const o = toCourt(yaw, h[0], h[1]);
      const short = 0.3 + ((b.seed * 13) % 5) * 0.06;
      const d = Math.hypot(dx, dy);
      const k = d > 1e-3 ? short / d : 0;
      const feetX = ball.x - o.x - dx * k;
      const feetY = ball.y - o.y - dy * k;
      // Never further than his legs can take him first.
      const far = Math.hypot(feetX - b.x, feetY - b.y);
      const can = Math.min(far, (MAX_SPEED * 0.55 * pre) / 1000);
      const u = far > 1e-3 ? can / far : 0;
      b.ox = b.x + (feetX - b.x) * u - b.tx;
      b.oy = b.y + (feetY - b.y) * u - b.ty;
    }
    const lunge = Math.min(320, pre * 0.75);
    const keys = timeline(pre, [
      [-pre, READY], [-lunge, DIG_LOW], [-Math.min(150, lunge * 0.5), reachShape], [0, hitShape, 'whip'],
      [wide ? 240 : 210, flat], [wide ? 640 : 700, flat], [wide ? 940 : 1020, up], [wide ? 1280 : 1380, READY],
    ]);
    b.action = { kind: 'dig', t0: now, tc, keys, jump: null, yaw, path: null, end: wide ? 1380 : 1480 };
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

  /**
   * The end of a point. Whoever won it — the hitter who put it away, the blocker who stuffed it,
   * the server's ace — lets it out, and his team-mates run to him; on any other point won, the
   * six come together in the middle of their half, hands in. The side that lost it takes it in
   * for a moment, then gathers too, quieter: a low five, the next one. Anyone down on the floor
   * gets up first.
   */
  private react(now: number, winner: 0 | 1, how?: Scene['how'], hero?: number): void {
    const huddles = new Map<number, { x: number; y: number; face: number; delay: number }>();
    for (const team of [0, 1] as const) {
      const six = [...this.bodies].filter(([p, b]) => !b.leaving && b.side === null && this.onCourt.has(p) && this.teamOf(p) === team);
      if (six.length < 2) continue;
      const won = team === winner;
      const star = won && hero !== undefined ? six.find(([p]) => p === hero) : undefined;
      let cx = six.reduce((s, [, b]) => s + b.x, 0) / six.length;
      let cy = six.reduce((s, [, b]) => s + b.y, 0) / six.length;
      const side = Math.sign(cy) || this.sides[team];
      if (star !== undefined) {
        // Everyone to the hero.
        cx = star[1].x;
        cy = star[1].y;
      }
      cx = Math.max(-3.6, Math.min(3.6, cx * (star !== undefined ? 1 : 0.6)));
      cy = side * Math.max(1.3, Math.min(6.5, Math.abs(cy) * (star !== undefined ? 1 : 0.8)));
      const ring = six.filter(([p, b]) => p !== star?.[0] && (won || grounded(b.shape) <= 0.5));
      // Round the ring in the order they stand, so nobody runs through anybody.
      ring.sort((a, b) => Math.atan2(a[1].y - cy, a[1].x - cx) - Math.atan2(b[1].y - cy, b[1].x - cx));
      const r = won ? 0.62 : 0.8;
      const first = ring[0]?.[1];
      const turn = first !== undefined ? Math.atan2(first.y - cy, first.x - cx) : 0;
      ring.forEach(([p], i) => {
        const a = turn + (i / ring.length) * Math.PI * 2;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        huddles.set(p, { x, y, face: yawTo(cx - x, cy - y), delay: won ? (star !== undefined ? 260 : 120) : 520 });
      });
      if (star !== undefined) huddles.set(star[0], { x: cx, y: cy, face: star[1].yaw, delay: 0 });
    }

    for (const [p, b] of this.bodies) {
      if (b.leaving) continue;
      const won = this.teamOf(p) === winner;
      const style = (b.seed * 7 + 3) % 3;
      const spot = huddles.get(p);
      let keys: Key[];
      let jump: Jump | null = null;
      if (!won && grounded(b.shape) > 0.5) {
        // Down after a ball that got past him: a moment on the floor first.
        keys = timeline(0, [[0, b.shape], [650, b.shape], [1000, DIVE_PUSH], [1450, HIPS], [2100, HIPS], [2500, STAND]]);
      } else if (won && p === hero && spot !== undefined) {
        // The one who won it: a roar for a block or an ace, a leap for a kill — then the others are on him.
        if (how === 'block' || how === 'ace') {
          keys = timeline(0, [[0, b.shape], [160, ROAR], [420, FIST_DOWN], [620, ROAR], [1000, ARMS_UP], [1350, HUDDLE_UP], [1750, HUDDLE_IN], [2150, STAND]]);
        } else {
          keys = timeline(0, [[0, b.shape], [200, ARMS_UP], [700, FIST], [950, FIST_DOWN], [1350, HUDDLE_UP], [1750, HUDDLE_IN], [2150, STAND]]);
          jump = { up: 140, peak: 330, down: 520, h: 0.3 };
        }
      } else if (won && spot !== undefined) {
        // Running in, hands up together in the middle, a slap, and back out.
        const slap = style === 0 ? ARMS_UP : HUDDLE_UP;
        keys = timeline(0, [[0, b.shape], [300, style === 2 ? FIST : CLAP_OPEN], [700, HUDDLE_IN], [900, slap], [1150, HUDDLE_UP], [1400, HUDDLE_IN], [1650, CLAP], [2050, STAND]]);
        if (style !== 1) jump = { up: 860, peak: 1000, down: 1140, h: 0.16 };
      } else if (won) {
        if (style === 0) {
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
      } else if (spot !== undefined) {
        // It sinks in — then together, a low five: the next one.
        const sag = style === 1 ? KNEES : HIPS;
        keys = timeline(0, [[0, b.shape], [320, sag], [800, sag], [1150, LOW_FIVE], [1350, CLAP], [1550, LOW_FIVE], [1950, STAND]]);
      } else {
        const sag = style === 1 ? KNEES : HIPS;
        keys = timeline(0, [[0, b.shape], [320, sag], [1300, sag], [1750, STAND]]);
      }
      const last = keys[keys.length - 1].t;
      b.reaction = { kind: won ? 'celebrate' : 'dejected', t0: now, tc: now, keys, jump, yaw: null, path: null, end: last + 60 };
      b.huddle = spot !== undefined ? { x: spot.x, y: spot.y, face: spot.face, from: now + spot.delay, until: now + last - 200 } : null;
    }
    this.coaches.forEach((c, t) => {
      const keys = t === winner
        ? timeline(0, [[0, c.shape], [160, CLAP_OPEN], [300, CLAP], [440, CLAP_OPEN], [580, CLAP], [1100, COACH_IDLE]])
        : timeline(0, [[0, c.shape], [340, HIPS], [1400, HIPS], [1900, COACH_IDLE]]);
      c.reaction = { kind: t === winner ? 'celebrate' : 'dejected', t0: now, tc: now, keys, jump: null, yaw: null, path: null,
        end: keys[keys.length - 1].t + 60 };
    });
  }

  /**
   * A final won, and the trophy presented, as it goes on television. First the winners — the bench
   * with them — run together into the middle of their half and go up and down in a huddle, while
   * the beaten side sink to their knees or stand with their hands on their hips. Then the man from
   * the federation walks out with the cup, the winners line up in front of the cameras, their
   * captain at the front, and the losers turn to watch and applaud. He hands the captain the cup —
   * the captain turned to him to take it — and the captain turns back and lifts it over his head,
   * everyone round him leaping with their arms up. The stand roars throughout. It goes on until the
   * screen moves on. `captain` lifts the cup — or, not with them, the first of the six.
   */
  trophyLift(winner: 0 | 1, captain: number | null, now: number): void {
    if (this.trophy !== null) return;
    this.flight = null;
    this.trail = [];
    this.actor = null;
    this.actorPose = null;
    this.point = null;
    this.live = false;
    this.calls = [];
    this.needServe = false;
    this.serveDue = null;
    this.signal = null;
    this.injury = null;
    const side = this.sides[winner];
    const ours = [...this.bodies].filter(([p, b]) => !b.leaving && this.teamOf(p) === winner);
    const cap = captain !== null && ours.some(([p]) => p === captain)
      ? captain
      : ours.find(([p]) => this.onCourt.has(p))?.[0] ?? ours[0]?.[0] ?? null;
    // The captain in the middle of the court's width, facing the cameras' side; the official by him, away from the net.
    const front = { x: 0.3, y: side * 3.4 };
    const huddle = { x: 0, y: side * 2.6 };
    const official = { x: 0.65, y: side * 4.35 };
    this.trophy = { team: winner, t0: now, captain: cap, huddle, at: { x: -0.6, y: front.y }, front, official, lift: TROPHY_LIFT_AT };
    const gather = now + TROPHY_GATHER_AT;
    const forever = now + 3_600_000;
    const toCameras = yawTo(1, 0);

    const reset = (b: Body): void => {
      b.side = null;
      b.home = null;
      b.via = null;
      b.huddle = null;
      b.action = null;
      b.reaction = null;
      b.ox = 0;
      b.oy = 0;
      b.pose = 'stand';
    };

    // Into the huddle: a ring, round the order they come from so nobody runs through anybody.
    ours.sort((a, b) => Math.atan2(a[1].y - huddle.y, a[1].x - huddle.x) - Math.atan2(b[1].y - huddle.y, b[1].x - huddle.x));
    const r = Math.max(0.75, ours.length * 0.085);
    ours.forEach(([, b], i) => {
      reset(b);
      const a = (i / ours.length) * Math.PI * 2;
      const x = huddle.x + Math.cos(a) * r;
      const y = huddle.y + Math.sin(a) * r;
      b.huddle = { x, y, face: yawTo(huddle.x - x, huddle.y - y), from: now, until: gather };
    });

    // Then the line-up: the others round behind the captain in rows, the rows filled from the middle out.
    const slots: Array<{ x: number; y: number }> = [];
    for (const [rr, n] of [[1.15, 5], [2.0, 7], [2.8, 9]] as const) {
      for (let k = 0; k < n; k++) {
        const a = -1.2 + (2.4 * k) / (n - 1);
        slots.push({ x: front.x - rr * Math.cos(a), y: front.y + rr * Math.sin(a) });
      }
    }
    const rest = ours.filter(([p]) => p !== cap);
    const taken = slots.slice(0, rest.length).sort((a, b) => a.y - b.y);
    rest.sort((a, b) => a[1].y - b[1].y);
    rest.forEach(([, b], i) => {
      b.tx = taken[i].x;
      b.ty = taken[i].y;
      b.steps = [{ x: taken[i].x, y: taken[i].y, face: toCameras, from: gather + (i % 5) * 90, until: forever }];
    });
    if (cap !== null) {
      // At the front — turned to the official to take the cup, then back to the cameras to lift it.
      const b = this.bodies.get(cap)!;
      const toHim = yawTo(official.x - front.x, official.y - front.y);
      b.tx = front.x;
      b.ty = front.y;
      b.steps = [
        { x: front.x, y: front.y, face: toCameras, from: gather, until: now + TROPHY_HAND_AT - 900 },
        { x: front.x, y: front.y, face: toHim, from: now + TROPHY_HAND_AT - 900, until: now + TROPHY_LIFT_AT - 450 },
        { x: front.x, y: front.y, face: toCameras, from: now + TROPHY_LIFT_AT - 450, until: forever },
      ];
    }

    // The beaten side where they are at first, then in its own half, turned to watch.
    const theirs = [...this.bodies].filter(([p, b]) => !b.leaving && b.side === null && this.teamOf(p) !== winner);
    theirs.sort((a, b) => a[1].x - b[1].x);
    theirs.forEach(([, b], i) => {
      reset(b);
      const x = -3.2 + (i % 3) * 1.25;
      const y = -side * (2.2 + Math.floor(i / 3) * 1.3);
      b.tx = b.x;
      b.ty = b.y;
      b.steps = [{ x, y, face: yawTo(front.x - x, front.y - y), from: gather + 400 + i * 80, until: forever }];
    });
    this.cheer = { team: winner, t0: now, big: true };
  }

  /** The federation's man, coming out with the cup: round behind the winners, to the captain's side, and back a step once it is handed over. */
  private officialOut(t: TrophyLift): Body {
    const side = Math.sign(t.front.y) || 1;
    const from = { x: OFFICIAL_FROM.x, y: side * OFFICIAL_FROM.y };
    const round = { x: 1.7, y: side * 7.4 };
    const after = { x: t.official.x + 0.45, y: t.official.y + side * 0.85 };
    const atCaptain = yawTo(t.front.x - t.official.x, t.front.y - t.official.y);
    const t0 = t.t0;
    return {
      x: from.x, y: from.y, tx: after.x, ty: after.y, ox: 0, oy: 0, vx: 0, vy: 0, yaw: yawTo(round.x - from.x, round.y - from.y),
      lift: 0, vz: 0, pose: 'stand', posture: STAND, shape: STAND, gait: 0, running: 0, action: null, reaction: null,
      alpha: 0, leaving: false, scale: 1.8 / REF_HEIGHT, hand: 1, seed: 41, rig: buildRig(STAND, STILL), side: null, via: null, home: null,
      pace: 1.7,
      steps: [
        { x: round.x, y: round.y, face: atCaptain, from: t0 + TROPHY_OFFICIAL_AT, until: t0 + TROPHY_OFFICIAL_AT + 4300 },
        { x: t.official.x, y: t.official.y, face: atCaptain, from: t0 + TROPHY_OFFICIAL_AT + 4300, until: t0 + TROPHY_HAND_AT + 700 },
        { x: after.x, y: after.y, face: yawTo(1, -side * 0.6), from: t0 + TROPHY_HAND_AT + 700, until: t0 + 3_600_000 },
      ],
    };
  }

  /** The trophy's moment, frame by frame: each body's next move as the last one ends, the stand kept roaring. */
  private stepTrophy(now: number): void {
    const t = this.trophy;
    if (t === null) return;
    const since = now - t.t0;
    const lifted = since >= t.lift;
    const together = since < TROPHY_GATHER_AT - 300;
    // The stand roars on — and again as it goes up.
    if (this.cheer === null || now - this.cheer.t0 > 3000 || (lifted && this.cheer.t0 < t.t0 + t.lift)) {
      this.cheer = { team: t.team, t0: now, big: true };
    }
    if (this.official === null && since >= TROPHY_OFFICIAL_AT) this.official = this.officialOut(t);
    const cycle = (b: Body, kind: Action['kind'], keys: Key[], jump: Jump | null, tc = now): void => {
      b.reaction = { kind, t0: now, tc, keys, jump, yaw: null, path: null, end: keys[keys.length - 1].t + 60 };
    };
    const clapping = (b: Body): Key[] => timeline(0, [
      [0, b.shape], [150, CLAP_OPEN], [300, CLAP], [450, CLAP_OPEN], [600, CLAP], [750, CLAP_OPEN], [900, CLAP],
    ]);
    for (const [p, b] of this.bodies) {
      if (b.leaving || b.reaction !== null) continue;
      const won = this.teamOf(p) === t.team;
      const style = (b.seed * 7 + Math.floor(now / 1013)) % 3;
      if (won && together) {
        // In the huddle: up and down together, on the beat.
        const beat = t.t0 + Math.ceil(since / 1000) * 1000;
        cycle(b, 'celebrate', timeline(0, [[0, b.shape], [220, HUDDLE_UP], [650, HUDDLE_IN], [950, HUDDLE_UP]]),
          { up: 180, peak: 380, down: 600, h: 0.3 }, beat);
      } else if (won && !lifted) {
        if (since >= TROPHY_GATHER_AT) b.pace = 2.6;
        if (p === t.captain && since >= TROPHY_HAND_AT - 500) {
          // His hands out for it, and on it, until the moment.
          const wait = t.lift - since;
          cycle(b, 'stand', timeline(0, [[0, b.shape], [Math.min(450, wait), TROPHY_CARRY], [Math.max(470, wait - 60), TROPHY_CARRY]]), null);
          b.reaction!.end = wait;
        } else {
          cycle(b, 'celebrate', clapping(b), null);
        }
      } else if (won && p === t.captain) {
        // Up it goes — and stays up, raised again and again.
        const keys: Array<[number, Shape]> = [[0, b.shape], [380, TROPHY_UP]];
        for (let k = 1; k < 80; k++) keys.push([380 + k * 650, k % 2 === 1 ? TROPHY_HIGH : TROPHY_UP]);
        cycle(b, 'celebrate', timeline(0, keys), since < t.lift + 500 ? { up: 120, peak: 330, down: 560, h: 0.24 } : null);
      } else if (won) {
        if (style === 0) {
          cycle(b, 'celebrate', timeline(0, [[0, b.shape], [180, ARMS_UP], [900, ARMS_UP], [1250, STAND]]),
            { up: 120, peak: 330, down: 560, h: 0.3 + (b.seed % 3) * 0.05 });
        } else if (style === 1) {
          cycle(b, 'celebrate', timeline(0, [[0, b.shape], [170, FIST], [380, FIST_DOWN], [600, FIST], [850, FIST_DOWN], [1150, ARMS_UP]]), null);
        } else {
          cycle(b, 'celebrate', timeline(0, [[0, b.shape], [200, ARMS_UP], [650, HUDDLE_UP], [1100, ARMS_UP], [1400, STAND]]),
            { up: 160, peak: 360, down: 560, h: 0.22 });
        }
      } else if (since < TROPHY_GATHER_AT) {
        // It sinks in: down on their knees, or hands on hips, head down.
        const low = b.seed % 2 === 0 ? KNEES : HIPS;
        cycle(b, 'dejected', timeline(0, [[0, b.shape], [500, low], [Math.max(520, TROPHY_GATHER_AT - since), low]]), null);
      } else if (since < TROPHY_HAND_AT - 400 || (b.seed + Math.floor(now / 1700)) % 3 === 0) {
        cycle(b, 'stand', timeline(0, [[0, b.shape], [400, STAND], [1700, STAND]]), null);
      } else {
        // Then, like sportsmen, they applaud.
        cycle(b, 'stand', timeline(0, [
          [0, b.shape], [200, CLAP_OPEN], [380, CLAP], [560, CLAP_OPEN], [740, CLAP], [920, CLAP_OPEN], [1100, CLAP], [1700, STAND],
        ]), null);
      }
    }
    const o = this.official;
    if (o !== null && o.reaction === null) {
      if (since < TROPHY_HAND_AT) {
        // The cup held out in front of him, all the way.
        const wait = TROPHY_HAND_AT - since;
        cycle(o, 'stand', timeline(0, [[0, o.shape], [Math.min(400, wait), TROPHY_CARRY], [Math.max(420, wait), TROPHY_CARRY]]), null);
        o.reaction!.end = wait + 120;
      } else {
        cycle(o, 'stand', since < t.lift + 2500 ? clapping(o) : timeline(0, [[0, o.shape], [400, STAND], [1600, STAND]]), null);
      }
    }
    this.coaches.forEach((c, team) => {
      if (c.reaction !== null && now - c.reaction.tc <= c.reaction.end) return;
      const keys = team === t.team
        ? timeline(0, [[0, c.shape], [200, ARMS_UP], [900, ARMS_UP], [1300, CLAP_OPEN], [1450, CLAP], [1800, COACH_IDLE]])
        : timeline(0, [[0, c.shape], [300, CLAP_OPEN], [450, CLAP], [600, CLAP_OPEN], [750, CLAP], [1500, COACH_IDLE]]);
      c.reaction = { kind: 'celebrate', t0: now, tc: now, keys, jump: null, yaw: null, path: null, end: keys[keys.length - 1].t + 60 };
    });
  }

  /** The ball, where it is now. */
  ballAt(now: number): Ball3 | null {
    return this.flight !== null ? flightAt(this.flight, now) : null;
  }

  /** Move everyone on by `dt` seconds, to the moment `now`. */
  step(dt: number, now: number): void {
    if (this.point !== null && now >= this.point.at) {
      // Where it came down, and the line judge's flag for it.
      const landing = this.flight?.to;
      if (landing !== undefined && landing.z < 0.6) this.flagLanding(now, landing, this.point.out);
      this.react(now, this.point.team, this.point.how, this.point.hero);
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
        && this.stoppage.timeout === null && !this.stoppage.paused && this.serverReady()) {
        this.whistle({ kind: 'serve', team: this.serveTeam, out: false }, now);
      }
    }
    if (this.signal !== null && now > this.signal.end) this.signal = null;
    this.stepTrophy(now);
    const ball = this.ballAt(now);
    this.stepReferee(dt, now, ball);
    for (const c of this.coaches) this.stepStill(c, dt, now, ball);
    for (const j of this.lineJudges) this.stepStill(j, dt, now, ball);
    this.stepMedic(dt, now);
    if (this.official !== null) this.stepBody(this.official, dt, now, null);
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
  private stepStill(r: Body, dt: number, now: number, ball: Ball3 | null): void {
    if (r.reaction !== null && now - r.reaction.tc > r.reaction.end) r.reaction = null;
    const f = flowOf(r);
    let s = r.posture;
    if (r.reaction !== null) s = mixShape(s, sample(r.reaction.keys, now - r.reaction.tc), weight(r.reaction, now));
    s = flowShape(f, s, dt, 0.1);
    r.shape = s;
    let lookYaw = 0;
    let lookPitch = 0;
    if (ball !== null) {
      const dx = ball.x - r.x;
      const dy = ball.y - r.y;
      lookYaw = Math.max(-1.2, Math.min(1.2, wrap(yawTo(dx, dy) - r.yaw)));
      lookPitch = 0.4 * Math.atan2(ball.z - 1.7, Math.max(0.5, Math.hypot(dx, dy)));
    }
    [lookYaw, lookPitch] = lookAt(f, lookYaw, lookPitch, dt);
    r.rig = buildRig(s, { ...STILL, lookYaw, lookPitch });
  }

  /** The referee stays put on the stand, following the ball with their eyes
   *  between signals. */
  private stepReferee(dt: number, now: number, ball: Ball3 | null): void {
    const r = this.referee;
    if (r.reaction !== null && now - r.reaction.tc > r.reaction.end) r.reaction = null;
    const f = flowOf(r);
    let s = r.posture;
    if (r.reaction !== null) s = mixShape(s, sample(r.reaction.keys, now - r.reaction.tc), weight(r.reaction, now));
    s = flowShape(f, s, dt, 0.1);
    r.shape = s;
    let lookYaw = 0;
    let lookPitch = 0;
    if (ball !== null) {
      const dx = ball.x - r.x;
      const dy = ball.y - r.y;
      lookYaw = wrap(yawTo(dx, dy) - r.yaw);
      lookPitch = 0.5 * Math.atan2(ball.z - r.lift - 1.7, Math.max(0.5, Math.hypot(dx, dy)));
    }
    [lookYaw, lookPitch] = lookAt(f, lookYaw, lookPitch, dt);
    r.rig = buildRig(s, { ...STILL, lookYaw, lookPitch });
  }

  private stepBody(b: Body, dt: number, now: number, ball: Ball3 | null): void {
    const a = b.action;
    if (a !== null && now - a.tc > a.end) b.action = null;
    if (b.reaction !== null && now - b.reaction.tc > b.reaction.end) b.reaction = null;
    const action = b.action;
    const rel = action !== null ? now - action.tc : 0;
    const f = flowOf(b);

    // ---- Where the feet go ----
    const px = b.x;
    const py = b.y;
    const pvx = b.vx;
    const pvy = b.vy;
    const path = action?.path ?? null;
    if (path !== null && rel >= path.go && rel <= path.down) {
      if (!path.started) {
        path.started = true;
        path.from = { x: b.x, y: b.y };
        path.v0 = { x: b.vx, y: b.vy };
      }
      if (rel < path.up) {
        // One curve from where they are, at the pace they were going, braking into the plant at
        // the pace the jump carries on: no stop as the run-up begins, none as they leave the floor.
        const span = Math.max(1, path.up - path.go) / 1000;
        const air = Math.max(1, path.down - path.up) / 1000;
        const toX = path.plant.x - path.from.x;
        const toY = path.plant.y - path.from.y;
        // Going the wrong way, they don't loop out wide first.
        const lead = Math.hypot(path.v0.x, path.v0.y) * span;
        const room = 1.5 * Math.hypot(toX, toY) + 0.4;
        const q = lead > room ? room / lead : 1;
        const u = Math.min(1, Math.max(0, (rel - path.go) / Math.max(1, path.up - path.go)));
        const u2 = u * u;
        const u3 = u2 * u;
        const h10 = (u3 - 2 * u2 + u) * span * q;
        const h01 = 3 * u2 - 2 * u3;
        const h11 = (u3 - u2) * span;
        b.x = path.from.x + toX * h01 + path.v0.x * h10 + ((path.land.x - path.plant.x) / air) * h11;
        b.y = path.from.y + toY * h01 + path.v0.y * h10 + ((path.land.y - path.plant.y) / air) * h11;
      } else {
        const u = (rel - path.up) / Math.max(1, path.down - path.up);
        b.x = path.plant.x + (path.land.x - path.plant.x) * u;
        b.y = path.plant.y + (path.land.y - path.plant.y) * u;
      }
      if (rel > path.up && path.stale !== true) {
        // Once in the air the mark is wherever they come down.
        b.ox = path.land.x - b.tx;
        b.oy = path.land.y - b.ty;
      }
      if (dt > 0) {
        b.vx = (b.x - px) / dt;
        b.vy = (b.y - py) / dt;
      }
    } else {
      const waiting = path !== null && rel < path.go;
      if (b.via !== null && Math.hypot(b.via.x - b.x, b.via.y - b.y) < 0.3) {
        // At the substitution zone: a slap of hands, and on.
        b.via = null;
        const keys = timeline(0, [[0, b.shape], [140, SLAP], [380, SLAP], [620, b.posture]]);
        b.reaction = { kind: 'celebrate', t0: now, tc: now, keys, jump: null, yaw: null, path: null, end: 680 };
      }
      const spot = spotFor(b, now);
      const goalX = spot !== null ? spot.x : b.via !== null ? b.via.x : b.tx + b.ox;
      const goalY = spot !== null ? spot.y : b.via !== null ? b.via.y : b.ty + b.oy;
      const dx = (waiting ? path.from.x : goalX) - b.x;
      const dy = (waiting ? path.from.y : goalY) - b.y;
      const dist = Math.hypot(dx, dy);
      // Down hurt, nobody moves him; on a bad leg, he hobbles. Flat out on
      // the floor after a dive, he goes nowhere until he is up again.
      const floored = Math.min(1, Math.max(0, (grounded(b.shape) - 1.0) * 3));
      const flat = b.pace ?? MAX_SPEED;
      const top = ((b.hurtGoal ?? 0) >= 1 ? 0 : b.limp === true ? flat * 0.2 : flat) * (1 - floored);
      if (b.lift < 0.05) {
        // As fast as they can go and still stop on the mark, easing off the last stretch; speeding
        // up and braking as legs can — harder to brake than to push off — never starting or
        // stopping dead.
        const want = dist > 0.005 ? Math.min(top, Math.sqrt(2 * BRAKE * dist), dist / SETTLE) / dist : 0;
        const ex = dx * want - b.vx;
        const ey = dy * want - b.vy;
        const e = Math.hypot(ex, ey);
        const most = (ex * b.vx + ey * b.vy < 0 ? BRAKE : ACCEL) * dt;
        const k = e > most ? most / e : 1;
        b.vx += ex * k;
        b.vy += ey * k;
      } else {
        // Off the floor they carry on the way they were going, the jump soon taking it out of them.
        const k = Math.exp(-dt / 0.15);
        b.vx *= k;
        b.vy *= k;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    if (dt > 0) {
      // How hard they are speeding up or braking: the body leans with it.
      f.ax.step((b.vx - pvx) / dt, dt, 0.16);
      f.ay.step((b.vy - pvy) / dt, dt, 0.16);
    }
    const speed = Math.hypot(b.vx, b.vy);

    // ---- Which way they face ----
    const net = netYaw(b.ty);
    const remaining = Math.hypot(b.tx + b.ox - b.x, b.ty + b.oy - b.y);
    let face: number;
    const huddle = spotFor(b, now);
    if (huddle !== null) {
      // Into the huddle: running to it, then facing in.
      const d = Math.hypot(huddle.x - b.x, huddle.y - b.y);
      face = d > 0.9 && speed > 1.5 ? yawTo(b.vx, b.vy) : huddle.face;
    } else if (action !== null && action.yaw !== null && rel > -Math.max(350, (action.tc - action.t0) * 0.6)) face = action.yaw;
    else if ((speed > 2.6 && remaining > 1.5) || (b.via !== null && speed > 0.8)) face = yawTo(b.vx, b.vy);
    else if (b.side !== null) face = yawTo(-b.x, -b.y * 0.5);
    else if (ball !== null && b.pose !== 'stand' && b.pose !== 'hold') face = clampYaw(yawTo(ball.x - b.x, ball.y - b.y), net, 1.2);
    else face = net;
    // Turning with a swing, not at a stroke. Lying on the floor, the body doesn't spin round to the ball.
    const lying = grounded(b.shape) > 0.7;
    b.yaw = wrap(f.yaw.step(f.yaw.x + wrap(face - f.yaw.x), dt, lying ? 0.5 : 0.09, TURN_RATE * (lying ? 0.05 : 1)));

    // ---- Off the floor ----
    const jumpNow = action !== null && action.jump !== null ? liftAt(action.jump, rel) : 0;
    const r = b.reaction;
    const hop = r !== null && r.jump !== null ? liftAt(r.jump, now - r.tc) * Math.max(0, 1 - speed / 2.5) : 0;
    const lift = Math.max(jumpNow, hop);
    if (lift > 0) {
      // Rising and falling with the jump — and, should it end before the floor comes, carrying
      // on down at the pace it was falling.
      b.vz = dt > 0 ? (lift - b.lift) / dt : 0;
      b.lift = lift;
    } else if (b.lift > 0) {
      // Only ever down from here: a jump over is never carried on upwards — as a long frame, its
      // time cut short, could make it look as if it were.
      b.vz = Math.min(0, b.vz) - 9.81 * dt;
      b.lift = Math.max(0, b.lift + b.vz * dt);
    }
    if (dt > 0) {
      // Leaving the floor and landing on it, the hips carry on as they were going and the legs take
      // up the difference: the feet snatched up off the floor, and a give at the knees as it stops them.
      const liftV = (b.lift - f.lift) / dt;
      if (f.lift === 0 && liftV > 1) f.shape[CROUCH].v += liftV * 0.8;
      if (b.lift === 0 && f.liftV < -1) f.shape[CROUCH].v -= f.liftV * 0.8;
      f.lift = b.lift;
      f.liftV = liftV;
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
    // Hurt: down on one knee, or bent over a bad leg; the physio crouched over him.
    const hurtGoal = b.hurtGoal ?? 0;
    if (hurtGoal > 0 || (b.hurt ?? 0) > 0.001) {
      b.hurt = (b.hurt ?? 0) + (hurtGoal - (b.hurt ?? 0)) * (1 - Math.exp(-dt / 0.28));
      s = mixShape(s, HURT, b.hurt);
    }
    if (b.limp === true && speed > 0.15) s = { ...s, crouch: s.crouch + 0.07 * Math.abs(Math.sin(b.gait)), bend: s.bend + 0.12 };
    if ((b.tend ?? 0) > 0.001) s = mixShape(s, TEND, b.tend!);
    // Every part of the body carries its momentum from one move into the next — tighter close to
    // a contact, so the hands still find the ball.
    const tight = action !== null && CONTACTS.has(action.kind as Pose) && Math.abs(rel) < 160;
    s = flowShape(f, s, dt, tight ? 0.05 : 0.1);
    b.shape = s;

    // ---- Running, and looking at the ball ----
    const legsX = f.moveX.step(moveX, dt, 0.06);
    const legsY = f.moveY.step(moveY, dt, 0.06);
    const legs = Math.hypot(legsX, legsY);
    b.gait += (Math.PI * legs * dt) / strideLength(legs);
    // Coming to a stop the feet come together under the body, to set off from there again.
    const still = Math.max(0, 1 - legs / 0.4);
    if (still > 0) b.gait += (Math.round(b.gait / Math.PI) * Math.PI - b.gait) * (1 - Math.exp(-dt / 0.15)) * still;
    let lookYaw = 0;
    let lookPitch = 0;
    if (ball !== null) {
      const dx = ball.x - b.x;
      const dy = ball.y - b.y;
      lookYaw = wrap(yawTo(dx, dy) - b.yaw);
      lookPitch = 0.45 * Math.atan2(ball.z - 1.7 * b.scale - b.lift, Math.max(0.5, Math.hypot(dx, dy)));
    }
    [lookYaw, lookPitch] = lookAt(f, lookYaw, lookPitch, dt);
    // Into the air the legs leave the run and draw up over the first of the rise, and reach down for the floor again on the way down.
    const airborne = smooth(b.lift / 0.2);
    const accelX = f.ax.x * c + f.ay.x * sn;
    const accelY = -f.ax.x * sn + f.ay.x * c;
    b.rig = buildRig(s, { hand: b.hand, gait: b.gait, moveX: legsX, moveY: legsY, airborne, lookYaw, lookPitch, accelX, accelY });

    const alphaTarget = b.leaving ? 0 : 1;
    b.alpha += (alphaTarget - b.alpha) * (1 - Math.exp(-dt / 0.25));
  }
}

/** Where a body is to be just now, if anywhere in particular: its huddle, or the step under way. */
function spotFor(b: Body, now: number): Spot | null {
  if (b.huddle != null && now >= b.huddle.from && now < b.huddle.until) return b.huddle;
  return b.steps?.find((s) => now >= s.from && now < s.until) ?? null;
}

/** How much a move is showing: easing in from its start, out towards its end. */
function weight(a: Action, now: number): number {
  const into = Math.min(160, (a.tc - a.t0) * 0.35);
  const wIn = into <= 0 ? 1 : smooth((now - a.t0) / into);
  const rel = now - a.tc;
  const wOut = 1 - smooth((rel - (a.end - 280)) / 280);
  return Math.min(wIn, wOut);
}
