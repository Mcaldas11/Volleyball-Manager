/**
 * Where everyone stands on the live court, moment by moment, and where the
 * ball flies.
 *
 * A rotation fixes the serving order, not where players actually stand. When
 * a side receives serve it lines its passers up and hides everyone else —
 * the setter tucked in at the net behind a front-row team-mate, ready to
 * release — and the instant the ball is served both sides switch into their
 * specialist spots: outside hitter left, middle in the middle, opposite and
 * setter right. All but one: a 5-1 receiving in P1 stays put — the outside
 * passing in zone 2 attacks on the right, the opposite on the left — until
 * it wins the point. This module turns the engine's rotational court (who is in
 * zones 1-6) into those real positions for every beat of a rally — serve
 * receive for the current rotation, base defence, the setter running to the
 * target whenever their side has the ball, hitters on their approach,
 * blockers closing on the attacker, a perimeter defence behind them — and
 * scripts the ball in three dimensions from contact to contact, including
 * the set the engine doesn't log as a contact of its own.
 *
 * Formations are worked out in each side's own frame: `u` across the court
 * from that team's own left (0) to its right (1) as its players face the
 * net, and `v` depth from the net (0) to its own baseline (1). They come out
 * in court metres: `x` across (-4.5 to 4.5, left to right as the viewer sees
 * it), `y` along the court with the net at 0, the near side (closest to the
 * camera) negative and the far side positive, and `z` height above the floor.
 */

import { effectivePlayerAt, isFrontRow, receptionUnit } from '../engine/match/court.ts';
import type { RallyContact } from '../engine/match/engine.ts';
import { Position } from '../engine/model/positions.ts';

/** A point on the floor, in court metres. */
export interface Ground {
  x: number;
  y: number;
}

/** A point in the air, in court metres. */
export interface Ball3 extends Ground {
  z: number;
}

/**
 * What a player's body is doing, for the court drawing. Two kinds: a
 * posture held while the play goes on around them — relaxed between rallies
 * (`stand`), on their toes while the ball is live (`ready`), crouched under a
 * team-mate's attack to cover the block (`cover`), the server with the ball
 * in their hands (`hold`) — and a contact, which the player times so that
 * their hands meet the ball as the beat's flight arrives: a jump serve with
 * its run-up (`serve`) or a float (`float`), a serve received (`receive`), a
 * hard-driven ball dug (`dig`), any other forearm pass (`pass`), a set, a
 * spike and a block.
 */
export type Pose =
  | 'stand' | 'ready' | 'cover' | 'hold'
  | 'serve' | 'float' | 'receive' | 'dig' | 'pass' | 'set' | 'spike' | 'block';

/** Everything the live court shows at one instant. */
export interface Scene {
  positions: Map<number, Ground>;
  /** What every player on court is doing. */
  poses: Map<number, Pose>;
  /** Where the ball is heading. */
  ball: Ball3 | null;
  /** How far the flight to `ball` rises above its higher end, m — 0 for a flat hit. */
  arc: number;
  /** Player making the current contact, marked on court. */
  actor: number | null;
  /** Where the actor sends the ball once they touch it — the next flight's
   *  end — so they can face it and follow through towards it. */
  aim?: Ball3 | null;
  /** The rally ends as this flight lands, won by this side (0 home, 1 away). */
  point?: 0 | 1 | null;
  /** …and it lands out, for the referee to call. */
  out?: boolean;
  /** How long the flight (and the players' moves) to this scene take, ms. */
  ms: number;
  /** Changes with every beat, so a renderer can tell repeat scenes apart. */
  seq?: number;
}

/** One step of a scripted rally. */
export interface Beat extends Scene {
  /** A contact worth a big on-screen callout, and the side it is good news for. */
  callout: { kind: RallyContact['kind']; team: 0 | 1 } | null;
}

/** Who stands in each rotational zone for both sides — a live snapshot or a logged rally's. */
export interface CourtState {
  homeCourt: number[];
  awayCourt: number[];
  homeLibero: number;
  awayLibero: number;
}

export const COURT_HALF_WIDTH = 4.5;
export const COURT_HALF_LENGTH = 9;
export const NET_HEIGHT = 2.43;

/**
 * The parabola bulge `h` for z(t) = lerp(a, b, t) + 4h·t(1-t) whose highest
 * point sits `above` metres over the higher end of a flight — raised further
 * if needed so that any flight crossing the net clears the tape.
 */
export function flightBulge(from: Ball3, to: Ball3, above: number): number {
  const a = from.z;
  const b = to.z;
  const apex = (h: number): number => {
    if (h <= 0) return Math.max(a, b);
    const t = Math.min(1, Math.max(0, 0.5 + (b - a) / (8 * h)));
    return a + (b - a) * t + 4 * h * t * (1 - t);
  };
  let h = 0;
  if (above > 0) {
    let lo = 0;
    let hi = 30;
    const target = Math.max(a, b) + above;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (apex(mid) < target) lo = mid;
      else hi = mid;
    }
    h = hi;
  }
  if (from.y * to.y < 0) {
    const tc = from.y / (from.y - to.y);
    const zc = a + (b - a) * tc + 4 * h * tc * (1 - tc);
    const need = NET_HEIGHT + 0.22 - zc;
    if (need > 0) h += need / (4 * tc * (1 - tc));
  }
  return h;
}

/** Where a ball is a fraction `t` of the way along its flight. */
export function ballAlong(from: Ball3, to: Ball3, bulge: number, t: number): Ball3 {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: Math.max(0, from.z + (to.z - from.z) * t + 4 * bulge * t * (1 - t)),
  };
}

/** A point in one team's own frame (see the module comment). */
interface Local {
  u: number;
  v: number;
}

type Formation = Map<number, Local>;

/** Across-court column of a rotational zone in the team's own frame:
 *  zones 4 and 5 on the left, 3 and 6 in the middle, 2 and 1 on the right. */
function column(zone: number): 0 | 1 | 2 {
  if (zone === 3 || zone === 4) return 0;
  if (zone === 2 || zone === 5) return 1;
  return 2;
}

const LANE_U = [0.18, 0.5, 0.82];

/** Where the setter delivers from: right of centre, tight to the net. */
const TARGET: Local = { u: 0.66, v: 0.09 };

/** Specialist lane each role switches to after the serve: 0 left, 1 middle, 2 right. */
const FRONT_LANE: Readonly<Record<Position, number>> = {
  [Position.OutsideHitter]: 0,
  [Position.MiddleBlocker]: 1,
  [Position.Libero]: 1,
  [Position.Opposite]: 2,
  [Position.Setter]: 2,
};
const BACK_LANE: Readonly<Record<Position, number>> = {
  [Position.Libero]: 0,
  [Position.MiddleBlocker]: 0,
  [Position.OutsideHitter]: 1,
  [Position.Opposite]: 2,
  [Position.Setter]: 2,
};

/** Where each attack lane (the engine's lane names) is hit from, and how high
 *  the set to it arcs — a quick is barely above the setter's hands. */
const HIT_POINT: Readonly<Record<string, Local & { setArc: number }>> = {
  'Outside': { u: 0.1, v: 0.07, setArc: 1.6 },
  'Second tempo outside': { u: 0.22, v: 0.08, setArc: 0.9 },
  'Quick (middle)': { u: 0.54, v: 0.07, setArc: 0.25 },
  'Opposite': { u: 0.9, v: 0.07, setArc: 1.3 },
  'Pipe': { u: 0.5, v: 0.38, setArc: 1.0 },
  'Back-row right': { u: 0.84, v: 0.38, setArc: 1.1 },
};

interface Team {
  /** Plays in the half closest to the camera. */
  near: boolean;
  /** Who is actually standing in each zone, with the libero swapped in. */
  zones: number[];
  /** The setter on court, or -1 if there somehow isn't one. */
  setter: number;
  /** Who passes serve — the engine's own reception unit. */
  passers: number[];
  role: (p: number) => Position;
  zoneOf: (p: number) => number;
  /** Receiving in P1 in a 5-1: the front row keeps its rotational places all rally. */
  noSwitch: boolean;
}

function buildTeam(near: boolean, court: number[], libero: number, positions: Uint8Array): Team {
  const zones = [0, 1, 2, 3, 4, 5].map((z) => effectivePlayerAt(court, z, positions, libero));
  const role = (p: number): Position => positions[p] as Position;
  const out = [0, 0, 0];
  const n = court.length === 6 ? receptionUnit(Int32Array.from(court), positions, libero, out) : 0;
  return {
    near,
    zones,
    // Two setters on court is a 4-2: the one in the back row sets, the one at the net hits.
    setter: zones.find((p, z) => (z === 0 || z >= 4) && role(p) === Position.Setter)
      ?? zones.find((p) => role(p) === Position.Setter) ?? -1,
    passers: out.slice(0, n),
    role,
    zoneOf: (p) => zones.indexOf(p),
    noSwitch: false,
  };
}

/** Where a front-row player plays from once the ball is in play: his specialist lane, or — not switching — his own column. */
function frontLane(t: Team, p: number): number {
  return t.noSwitch ? column(t.zoneOf(p)) : FRONT_LANE[t.role(p)];
}

/** A team-frame point in court metres. The near side faces away from the
 *  camera, so its left is the viewer's left; the far side is mirrored. */
function toWorld(near: boolean, l: Local): Ground {
  return near
    ? { x: -COURT_HALF_WIDTH + l.u * 2 * COURT_HALF_WIDTH, y: -l.v * COURT_HALF_LENGTH }
    : { x: COURT_HALF_WIDTH - l.u * 2 * COURT_HALF_WIDTH, y: l.v * COURT_HALF_LENGTH };
}

/** Give each player a lane by preference, the nearest free one if theirs is taken. */
function assignLanes(players: number[], preferred: (p: number) => number): Map<number, number> {
  const lanes = new Map<number, number>();
  const taken = new Set<number>();
  for (const p of [...players].sort((a, b) => preferred(a) - preferred(b))) {
    const want = preferred(p);
    const lane = [want, want - 1, want + 1, want - 2, want + 2].find((l) => l >= 0 && l <= 2 && !taken.has(l)) ?? want;
    lanes.set(p, lane);
    taken.add(lane);
  }
  return lanes;
}

/** Nudge apart any two players who would stand on top of each other. */
function spread(f: Formation): Formation {
  const entries = [...f.entries()];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i][1];
        const b = entries[j][1];
        if (Math.abs(a.u - b.u) < 0.08 && Math.abs(a.v - b.v) < 0.07) {
          const [left, right] = a.u <= b.u ? [a, b] : [b, a];
          left.u = Math.max(0.04, left.u - 0.04);
          right.u = Math.min(0.96, right.u + 0.04);
        }
      }
    }
  }
  return f;
}

/**
 * Serve receive. The passers spread across the court in the same
 * left-to-right order as their rotational spots; front-row players who don't
 * pass wait at the net; a back-row setter hides at the net behind the
 * front-row team-mate in their own column, ready to release; any other
 * back-row non-passer (usually the opposite) hides deep, ready to hit from
 * the back row.
 */
function receiveFormation(t: Team): Formation {
  const f: Formation = new Map();
  const passers = [...t.passers].sort((a, b) => column(t.zoneOf(a)) - column(t.zoneOf(b)));
  const lanes = passers.length >= 3 ? [0.18, 0.5, 0.82] : passers.length === 2 ? [0.3, 0.7] : [0.5];
  passers.forEach((p, i) => f.set(p, { u: lanes[i], v: isFrontRow(t.zoneOf(p)) ? 0.58 : 0.66 }));

  for (let z = 0; z < 6; z++) {
    const p = t.zones[z];
    if (f.has(p)) continue;
    const c = column(z);
    if (isFrontRow(z)) f.set(p, { u: LANE_U[c], v: p === t.setter ? 0.08 : 0.12 });
    else if (p === t.setter) f.set(p, { u: [0.1, 0.6, 0.9][c], v: 0.24 });
    else f.set(p, { u: LANE_U[c], v: 0.9 });
  }
  return spread(f);
}

/**
 * How a player serves: most hitters jump-serve off a run-up, most setters,
 * middles and liberos float it — with a few of each doing the other, so a
 * side's serves don't all look alike.
 */
export function serveStyle(p: number, role: Position): 'serve' | 'float' {
  const hitter = role === Position.OutsideHitter || role === Position.Opposite;
  return hitter ? (p % 5 === 0 ? 'float' : 'serve') : (p % 3 === 0 ? 'serve' : 'float');
}

/** Where a server starts, and where they strike the ball: a jump server
 *  leaves room for the run-up and hits over the baseline; a float server
 *  stands just behind it. */
function servePoints(t: Team, server: number): { from: Local; hit: Local; z: number } {
  return serveStyle(server, t.role(server)) === 'serve'
    ? { from: { u: 0.84, v: 1.17 }, hit: { u: 0.82, v: 1.01 }, z: 3.05 }
    : { from: { u: 0.84, v: 1.08 }, hit: { u: 0.84, v: 1.05 }, z: 2.55 };
}

/** The serving side at the moment of the serve: the server behind the
 *  baseline, the front row at the net and the back row in their zones. */
function serveFormation(t: Team): Formation {
  const f: Formation = new Map();
  for (let z = 0; z < 6; z++) {
    const c = column(z);
    if (z === 0) f.set(t.zones[z], { ...servePoints(t, t.zones[z]).from });
    else f.set(t.zones[z], { u: LANE_U[c], v: isFrontRow(z) ? 0.14 : 0.62 });
  }
  return f;
}

/** Base defence after the switch: outside left, middle centre, opposite or
 *  setter right at the net; libero left-back, outside middle-back, setter or
 *  opposite right-back. */
function defenceFormation(t: Team): Formation {
  const f: Formation = new Map();
  const front = t.zones.filter((_, z) => isFrontRow(z));
  const back = t.zones.filter((_, z) => !isFrontRow(z));
  for (const [p, lane] of assignLanes(front, (p) => frontLane(t, p))) {
    f.set(p, { u: LANE_U[lane], v: 0.12 });
  }
  for (const [p, lane] of assignLanes(back, (p) => BACK_LANE[t.role(p)])) {
    f.set(p, { u: LANE_U[lane], v: lane === 1 ? 0.84 : 0.72 });
  }
  return f;
}

/** In possession, before the set: the setter at the target and every
 *  available hitter on their approach. */
function offenceFormation(t: Team): Formation {
  const f: Formation = new Map();
  const front = t.zones.filter((p, z) => isFrontRow(z) && p !== t.setter);
  const back = t.zones.filter((p, z) => !isFrontRow(z) && p !== t.setter);
  if (t.setter >= 0) f.set(t.setter, { ...TARGET });
  const frontSpot = [{ u: 0.06, v: 0.38 }, { u: 0.48, v: 0.26 }, { u: 0.94, v: 0.38 }];
  const backSpot = [{ u: 0.24, v: 0.58 }, { u: 0.5, v: 0.66 }, { u: 0.84, v: 0.66 }];
  for (const [p, lane] of assignLanes(front, (p) => frontLane(t, p))) f.set(p, { ...frontSpot[lane] });
  for (const [p, lane] of assignLanes(back, (p) => BACK_LANE[t.role(p)])) f.set(p, { ...backSpot[lane] });
  return f;
}

/** The hit itself: the attacker at their contact point, team-mates closing
 *  in underneath to cover a block. */
function attackFormation(
  t: Team,
  attacker: number,
  lane: string | undefined,
): { f: Formation; hit: Local; setArc: number } {
  const f = offenceFormation(t);
  const known = lane !== undefined ? HIT_POINT[lane] : undefined;
  const hit: Local = known ?? { u: f.get(attacker)?.u ?? 0.5, v: 0.07 };
  for (const [p, l] of f) {
    if (p === attacker || p === t.setter) continue;
    f.set(p, { u: l.u + (hit.u - l.u) * 0.3, v: Math.max(0.3, l.v * 0.85) });
  }
  f.set(attacker, { u: hit.u, v: hit.v });
  return { f, hit, setArc: known?.setArc ?? 1.2 };
}

/** Defending an attack aimed from `hitU` (in this team's own frame): the two
 *  closest front-row players close the block on the hitter, the back row sets
 *  up a perimeter shaded towards the ball. */
function blockFormation(t: Team, hitU: number): { f: Formation; blockers: number[] } {
  const f = defenceFormation(t);
  const front = t.zones
    .filter((_, z) => isFrontRow(z))
    .sort((a, b) => Math.abs((f.get(a)?.u ?? 0.5) - hitU) - Math.abs((f.get(b)?.u ?? 0.5) - hitU));
  const target = Math.min(0.9, Math.max(0.1, hitU));
  const blockers = front.slice(0, 2);
  front.forEach((p, i) => {
    if (i === 0) f.set(p, { u: target - 0.06, v: 0.05 });
    else if (i === 1) f.set(p, { u: target + 0.06, v: 0.05 });
    else f.set(p, { u: f.get(p)?.u ?? 0.5, v: 0.14 });
  });
  const perimeter = [{ u: 0.14, v: 0.7 }, { u: 0.5, v: 0.88 }, { u: 0.86, v: 0.7 }];
  const back = t.zones.filter((_, z) => !isFrontRow(z));
  for (const [p, lane] of assignLanes(back, (p) => BACK_LANE[t.role(p)])) {
    const spot = perimeter[lane];
    f.set(p, { u: spot.u + (hitU - spot.u) * 0.15, v: spot.v });
  }
  return { f: spread(f), blockers };
}

/** A gap in a formation: the candidate spot furthest from every player, with
 *  `seed` choosing among the best few so balls don't always land alike. */
function holeIn(f: Formation, seed: number): Local {
  const candidates: Local[] = [
    { u: 0.14, v: 0.4 }, { u: 0.5, v: 0.3 }, { u: 0.86, v: 0.4 }, { u: 0.3, v: 0.92 },
    { u: 0.7, v: 0.92 }, { u: 0.5, v: 0.6 }, { u: 0.1, v: 0.78 }, { u: 0.9, v: 0.78 },
  ];
  const players = [...f.values()];
  const scored = candidates
    .map((c) => ({ c, d: Math.min(...players.map((p) => Math.hypot(p.u - c.u, p.v - c.v))) }))
    .sort((a, b) => b.d - a.d);
  return scored[Math.abs(seed) % Math.min(3, scored.length)].c;
}

/**
 * Where a pass or dig puts the ball up for the setter, by how good it was —
 * `q`, 0 to 1, the engine's own measure. A perfect one drops on the target at
 * the net; the worse it is, the further off the net it comes down, the wider
 * and the lower, until a bad one is three or four metres back or out towards
 * a sideline, low enough that the setter has to chase it and bump it up.
 * `jitter`, between -1 and 1, says which way it strays.
 */
export function passSpot(q: number, jitter: number): { at: Local; z: number; arc: number } {
  const miss = Math.min(1, Math.max(0, (0.66 - q) / 0.56));
  return {
    at: {
      u: Math.min(0.94, Math.max(0.12, TARGET.u + jitter * miss * 0.34)),
      v: TARGET.v + miss * (0.34 + 0.1 * Math.abs(jitter)),
    },
    z: 2.6 - miss * 0.85,
    // Mostly lower and flatter the worse it is; now and then shanked sky-high.
    arc: 2.0 - miss * 0.9 + (jitter > 0.55 ? miss * 1.6 : 0),
  };
}

/** A repeatable number between -1 and 1 for the `i`th contact of the rally seeded `seed`. */
function wobble(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function teamsOf(court: CourtState, positions: Uint8Array, nearTeam: 0 | 1, receiving: 0 | 1 | null = null): [Team, Team] {
  const teams: [Team, Team] = [
    buildTeam(nearTeam === 0, court.homeCourt, court.homeLibero, positions),
    buildTeam(nearTeam === 1, court.awayCourt, court.awayLibero, positions),
  ];
  // A 5-1 receiving in P1 — its one setter in zone 1 — keeps its places.
  if (receiving !== null) {
    const t = teams[receiving];
    const setters = t.zones.filter((p) => t.role(p) === Position.Setter).length;
    t.noSwitch = setters === 1 && t.role(t.zones[0]) === Position.Setter;
  }
  return teams;
}

/** A fresh formation per side: the serving side ready to serve, the other ready to pass. */
function openingFormations(teams: [Team, Team], serving: 0 | 1): [Formation, Formation] {
  const forms: [Formation, Formation] = [new Map(), new Map()];
  forms[serving] = serveFormation(teams[serving]);
  forms[1 - serving] = receiveFormation(teams[1 - serving]);
  return forms;
}

function toPositions(teams: [Team, Team], forms: [Formation, Formation]): Map<number, Ground> {
  const out = new Map<number, Ground>();
  for (const t of [0, 1] as const) {
    for (const [p, l] of forms[t]) out.set(p, toWorld(teams[t].near, l));
  }
  return out;
}

/** The court between rallies: both sides set up for the next serve, the ball
 *  in the server's hands. `nearTeam` plays in the half closest to the camera. */
export function setupScene(court: CourtState, serving: 0 | 1, positions: Uint8Array, nearTeam: 0 | 1): Scene {
  const teams = teamsOf(court, positions, nearTeam);
  const forms = openingFormations(teams, serving);
  const server = teams[serving].zones[0];
  const hand = forms[serving].get(server);
  const at = hand !== undefined ? toWorld(teams[serving].near, hand) : null;
  // The passers get down into their stance; everyone else waits on the serve.
  const poses = new Map<number, Pose>();
  for (const t of [0, 1] as const) {
    for (const p of forms[t].keys()) poses.set(p, t !== serving && teams[t].passers.includes(p) ? 'ready' : 'stand');
  }
  if (at !== null) poses.set(server, 'hold');
  return {
    positions: toPositions(teams, forms),
    poses,
    ball: at !== null ? { ...at, z: 1.1 } : null,
    arc: 1.4,
    actor: null,
    ms: 900,
  };
}

/**
 * Script one logged rally as a sequence of beats — where every player is and
 * what they are doing, and where the ball flies — at each contact. `court` is
 * the arrangement the rally was played in; `seed` varies where unreturned
 * balls land; `winner`, when known, is marked on the last beat so the court
 * can celebrate the point as the ball lands.
 */
export function rallyBeats(
  court: CourtState,
  serveTeam: 0 | 1,
  contacts: readonly RallyContact[],
  positions: Uint8Array,
  seed: number,
  nearTeam: 0 | 1,
  winner: 0 | 1 | null = null,
): Beat[] {
  const teams = teamsOf(court, positions, nearTeam, (1 - serveTeam) as 0 | 1);
  const forms = openingFormations(teams, serveTeam);
  const beats: Beat[] = [];
  const at = (t: 0 | 1, p: number): Local => forms[t].get(p) ?? { u: 0.5, v: 0.5 };
  const air = (t: 0 | 1, l: Local, z: number): Ball3 => ({ ...toWorld(teams[t].near, l), z });
  const push = (
    ball: Ball3, actor: number | null, ms: number, arc: number,
    poses: Array<[number, Pose]> = [], callout: Beat['callout'] = null,
  ): void => {
    // Once the ball is in play everyone is on their toes, bar whoever is doing something.
    const all = new Map<number, Pose>();
    for (const f of forms) for (const p of f.keys()) all.set(p, 'ready');
    for (const [p, pose] of poses) all.set(p, pose);
    beats.push({
      positions: toPositions(teams, forms), poses: all, ball, arc, actor, ms, callout,
    });
  };

  // The side that has just passed or dug still has to set before it can hit:
  // where the first touch sent the ball and who made it — and, once set, who
  // set it from where.
  let needsSet = false;
  let pass: { spot: ReturnType<typeof passSpot>; ms: number } | null = null;
  let firstTouch = -1;
  let setFrom: { p: number; at: Local } | null = null;
  // Who the engine says set the ball — the setter, the other setter in a 4-2,
  // or the libero when the setter played the first ball or couldn't reach it.
  let engineSetter: number | null = null;
  // The setter takes the second ball, unless they made the first touch: then
  // the libero, or failing that the opposite, steps in.
  const setterFor = (t: 0 | 1, busy: number[]): number => {
    const team = teams[t];
    if (team.setter >= 0 && !busy.includes(team.setter)) return team.setter;
    const free = (role: Position): number | undefined =>
      team.zones.find((p) => team.role(p) === role && !busy.includes(p));
    return free(Position.Libero) ?? free(Position.Opposite) ?? team.zones.find((p) => !busy.includes(p)) ?? -1;
  };
  const setBall = (t: 0 | 1, attacker = -1): void => {
    const before = forms[t];
    forms[t] = offenceFormation(teams[t]);
    const { spot, ms } = pass ?? { spot: passSpot(1, 0), ms: 680 };
    const setter = engineSetter ?? setterFor(t, [firstTouch, attacker]);
    engineSetter = null;
    // A setter who dug the ball stays down where they dug it.
    const own = teams[t].setter;
    if (own >= 0 && own !== setter) forms[t].set(own, before.get(own) ?? { u: 0.5, v: 0.5 });
    if (setter >= 0) {
      forms[t].set(setter, { ...spot.at });
      // Anyone waiting where the ball comes down gets out of the setter's way.
      for (const [p, l] of forms[t]) {
        const du = l.u - spot.at.u;
        const dv = l.v - spot.at.v;
        const d = Math.hypot(du, dv);
        if (p === setter || d >= 0.12) continue;
        const k = 0.12 / Math.max(1e-3, d);
        forms[t].set(p, {
          u: Math.min(0.96, Math.max(0.04, spot.at.u + (d > 1e-3 ? du : 1) * k)),
          v: Math.min(1, Math.max(0.04, spot.at.v + (d > 1e-3 ? dv : 0) * k)),
        });
      }
    }
    setFrom = setter >= 0 ? { p: setter, at: spot.at } : null;
    // Chasing the ball down: a pass too low to take overhead gets bumped up.
    push(air(t, spot.at, spot.z), setter >= 0 ? setter : null, ms, spot.arc,
      setter >= 0 ? [[setter, spot.z >= 2.25 ? 'set' : 'pass']] : []);
    needsSet = false;
    pass = null;
  };

  // The toss: up out of the server's hands and down to where they strike it —
  // forward over the baseline for a jump server, who runs in under it.
  const serve = (t: 0 | 1, p: number): Local => {
    const { hit, z } = servePoints(teams[t], p);
    forms[t].set(p, { ...hit });
    const style = serveStyle(p, teams[t].role(p));
    push(air(t, hit, z), p, style === 'serve' ? 900 : 700, style === 'serve' ? 1.3 : 0.7, [[p, style]]);
    return hit;
  };

  contacts.forEach((c, i) => {
    const t = c.team;
    const o = (1 - t) as 0 | 1;
    switch (c.kind) {
      case 'serve':
        serve(t, c.player);
        break;
      case 'serveError': {
        const from = serve(t, c.player);
        // Into the net: the ball dies against the tape on the server's own side.
        push({ ...toWorld(teams[t].near, { u: from.u, v: 0.02 }), z: 1.7 }, null, 760, 0.6, [],
          { kind: 'serveError', team: o });
        break;
      }
      case 'ace':
        forms[t] = defenceFormation(teams[t]);
        push(air(o, holeIn(forms[o], seed), 0), null, 900, 0.9, [], { kind: 'ace', team: t });
        break;
      case 'reception':
      case 'receptionError': {
        // The serving side switches into its specialist spots as the serve crosses,
        // and the receiving setter releases from hiding to the target.
        forms[o] = defenceFormation(teams[o]);
        const passer = at(t, c.player);
        const setter = teams[t].setter;
        if (setter >= 0 && setter !== c.player) forms[t].set(setter, { ...TARGET });
        // A bad pass is a stretch: the passer lunges for it, low.
        const q = c.kind === 'receptionError' ? 0 : c.quality ?? 0.6;
        const stretched = q < 0.3;
        push(air(t, passer, stretched ? 0.45 : 0.7), c.player, 900, 0.9, [[c.player, stretched ? 'dig' : 'receive']]);
        if (c.kind === 'receptionError') {
          push(air(t, { u: passer.u < 0.5 ? -0.1 : 1.1, v: Math.min(1.1, passer.v + 0.3) }, 0), null, 620, 1.3);
        } else {
          pass = { spot: passSpot(q, wobble(seed, i)), ms: 680 };
          firstTouch = c.player;
          needsSet = true;
        }
        break;
      }
      case 'set':
        engineSetter = c.player;
        break;
      case 'setError': {
        engineSetter = c.player;
        setBall(t);
        const from = setFrom?.at ?? TARGET;
        push(air(t, { u: from.u, v: Math.max(0.3, from.v + 0.15) }, 0), null, 460, 0.4);
        break;
      }
      case 'freeball': {
        setBall(t);
        forms[t] = defenceFormation(teams[t]);
        const catcher = teams[o].zones.find((p) => teams[o].role(p) === Position.Libero)
          ?? teams[o].passers[0] ?? teams[o].zones[5];
        push(air(o, at(o, catcher), 0.7), catcher, 950, 2.4, [[catcher, 'pass']]);
        pass = { spot: passSpot(0.8, wobble(seed, i)), ms: 720 };
        firstTouch = catcher;
        needsSet = true;
        break;
      }
      case 'attack':
      case 'kill':
      case 'attackError':
      case 'blocked': {
        const { f, hit, setArc } = attackFormation(teams[t], c.player, c.detail);
        if (needsSet) setBall(t, c.player);
        // Whoever set stays where they set from, to cover.
        if (setFrom !== null && setFrom.p !== c.player) f.set(setFrom.p, { ...setFrom.at });
        setFrom = null;
        forms[t] = f;
        const { f: block, blockers } = blockFormation(teams[o], 1 - hit.u);
        forms[o] = block;
        const blockPoses: Array<[number, Pose]> = blockers.map((b) => [b, 'block']);
        // Team-mates crouch in under the hitter, ready for a ball off the block.
        const cover: Array<[number, Pose]> = [...forms[t].keys()].filter((p) => p !== c.player).map((p) => [p, 'cover']);
        const backRow = hit.v > 0.2;
        // A high ball to the pin hangs long enough for a full run-up; a quick is on the hitter at once.
        push(air(t, hit, backRow ? 3.0 : 3.15), c.player, Math.round(380 + setArc * 380), setArc,
          [...cover, [c.player, 'spike'], ...blockPoses]);
        if (c.kind === 'kill') {
          push(air(o, holeIn(forms[o], seed + i), 0), null, 340, 0, blockPoses, { kind: 'kill', team: t });
        } else if (c.kind === 'attackError') {
          push(air(o, { u: Math.min(0.95, Math.max(0.05, 1 - hit.u)), v: 1.12 }, 0), null, 420, 0.3, [],
            { kind: 'attackError', team: o });
        } else if (c.kind === 'blocked') {
          const blocker = blockers[0];
          if (blocker !== undefined) {
            const bl = at(o, blocker);
            push(air(o, { u: bl.u, v: 0.02 }, 2.75), blocker, 200, 0, blockPoses, { kind: 'blocked', team: o });
          }
          push(air(t, { u: hit.u, v: 0.22 }, 0), null, 520, 0.6);
        }
        break;
      }
      case 'blockTouch': {
        // The engine picks the blocker by zone, which may not be one of the two
        // shown closing the block — whoever it is, they are up at the net.
        const bl = at(t, c.player);
        forms[t].set(c.player, { u: bl.u, v: 0.05 });
        push(air(t, { u: bl.u, v: 0.02 }, 2.75), c.player, 220, 0, [[c.player, 'block']]);
        break;
      }
      case 'dig':
      case 'digError': {
        push(air(t, at(t, c.player), 0.5), c.player, 340, 0, [[c.player, 'dig']]);
        // The side that just attacked recovers into its defence.
        forms[o] = defenceFormation(teams[o]);
        if (c.kind === 'dig') {
          // A dig pops up higher than a pass, and is seldom right on target.
          const spot = passSpot(c.quality ?? 0.45, wobble(seed, i));
          pass = { spot: { ...spot, arc: spot.arc + 0.6 }, ms: 820 };
          firstTouch = c.player;
          needsSet = true;
        } else {
          push(air(t, { u: at(t, c.player).u, v: 1.1 }, 0), null, 520, 1.2);
        }
        break;
      }
      default:
        break;
    }
  });
  // Each contact is aimed where the ball flies next.
  beats.forEach((b, i) => {
    b.aim = b.actor !== null ? beats[i + 1]?.ball ?? null : null;
  });
  const last = beats[beats.length - 1];
  if (last !== undefined) {
    last.point = winner;
    last.out = contacts[contacts.length - 1]?.kind === 'attackError';
  }
  return beats;
}
