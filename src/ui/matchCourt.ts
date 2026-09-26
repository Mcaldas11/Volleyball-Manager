/**
 * Where everyone stands on the live court, moment by moment.
 *
 * A rotation fixes the serving order, not where players actually stand. When
 * a side receives serve it lines its passers up and hides everyone else —
 * the setter tucked in at the net behind a front-row team-mate, ready to
 * release — and the instant the ball is served both sides switch into their
 * specialist spots: outside hitter left, middle in the middle, opposite and
 * setter right. This module turns the engine's rotational court (who is in
 * zones 1-6) into those real positions for every beat of a rally — serve
 * receive for the current rotation, base defence, the setter running to the
 * target whenever their side has the ball, hitters on their approach,
 * blockers closing on the attacker, a perimeter defence behind them — and
 * scripts the ball from contact to contact, including the set the engine
 * doesn't log as a contact of its own.
 *
 * Each side works in its own frame: `u` runs across the court from that
 * team's own left (0) to its right (1) as its players face the net, and `v`
 * is depth from the net (0) to its own baseline (1). On screen the home side
 * plays in the top half and the away side in the bottom half, each mirrored
 * so it sees the court the way it faces it.
 */

import { effectivePlayerAt, isFrontRow, receptionUnit } from '../engine/match/court.ts';
import type { RallyContact } from '../engine/match/engine.ts';
import { Position } from '../engine/model/positions.ts';

export type Side = 'home' | 'away';

/** A point on screen, in % of the court box. */
export interface Pt {
  x: number;
  y: number;
}

/** A point in one team's own frame (see the module comment). */
interface Local {
  u: number;
  v: number;
}

type Formation = Map<number, Local>;

/** Who stands in each rotational zone for both sides — a live snapshot or a logged rally's. */
export interface CourtState {
  homeCourt: number[];
  awayCourt: number[];
  homeLibero: number;
  awayLibero: number;
}

/** Everything the live court draws at one instant. */
export interface Scene {
  positions: Map<number, Pt>;
  ball: Pt | null;
  /** The ball is in a high flight — a serve or a set — rather than hit flat. */
  high: boolean;
  /** Player making the current contact, highlighted on court. */
  actor: number | null;
  /** How long the ball and the players take to reach this scene, ms. */
  ms: number;
  /** Changes with every beat, so the ball's flight animation restarts each time. */
  seq?: number;
}

/** One step of a scripted rally. */
export interface Beat extends Scene {
  /** A contact worth a big on-screen callout, and the side it is good news for. */
  callout: { kind: RallyContact['kind']; team: 0 | 1 } | null;
}

export function toScreen(side: Side, l: Local): Pt {
  const u = side === 'home' ? 1 - l.u : l.u;
  return {
    x: 10 + u * 80,
    y: side === 'home' ? 50 - l.v * 50 : 50 + l.v * 50,
  };
}

/** Across-court column of a rotational zone in the team's own frame:
 *  zones 4 and 5 on the left, 3 and 6 in the middle, 2 and 1 on the right. */
function column(zone: number): 0 | 1 | 2 {
  if (zone === 3 || zone === 4) return 0;
  if (zone === 2 || zone === 5) return 1;
  return 2;
}

const LANE_U = [0.18, 0.5, 0.82];

/** Where the setter delivers from: right of centre, tight to the net. */
const TARGET: Local = { u: 0.66, v: 0.1 };

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

/** Where each attack lane (the engine's lane names) is hit from. */
const HIT_POINT: Readonly<Record<string, Local>> = {
  'Outside': { u: 0.1, v: 0.09 },
  'Second tempo outside': { u: 0.22, v: 0.1 },
  'Quick (middle)': { u: 0.54, v: 0.08 },
  'Opposite': { u: 0.9, v: 0.09 },
  'Pipe': { u: 0.5, v: 0.38 },
  'Back-row right': { u: 0.84, v: 0.38 },
};

interface Team {
  side: Side;
  /** Who is actually standing in each zone, with the libero swapped in. */
  zones: number[];
  /** The setter on court, or -1 if there somehow isn't one. */
  setter: number;
  /** Who passes serve — the engine's own reception unit. */
  passers: number[];
  role: (p: number) => Position;
  zoneOf: (p: number) => number;
}

function buildTeam(side: Side, court: number[], libero: number, positions: Uint8Array): Team {
  const zones = [0, 1, 2, 3, 4, 5].map((z) => effectivePlayerAt(court, z, positions, libero));
  const role = (p: number): Position => positions[p] as Position;
  const out = [0, 0, 0];
  const n = court.length === 6 ? receptionUnit(Int32Array.from(court), positions, libero, out) : 0;
  return {
    side,
    zones,
    setter: zones.find((p) => role(p) === Position.Setter) ?? -1,
    passers: out.slice(0, n),
    role,
    zoneOf: (p) => zones.indexOf(p),
  };
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

/** Nudge apart any two players who would be drawn on top of each other. */
function spread(f: Formation): Formation {
  const entries = [...f.entries()];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i][1];
        const b = entries[j][1];
        if (Math.abs(a.u - b.u) < 0.1 && Math.abs(a.v - b.v) < 0.09) {
          const [left, right] = a.u <= b.u ? [a, b] : [b, a];
          left.u = Math.max(0.04, left.u - 0.05);
          right.u = Math.min(0.96, right.u + 0.05);
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
    if (isFrontRow(z)) f.set(p, { u: LANE_U[c], v: p === t.setter ? 0.1 : 0.13 });
    else if (p === t.setter) f.set(p, { u: [0.08, 0.6, 0.92][c], v: 0.26 });
    else f.set(p, { u: LANE_U[c], v: 0.9 });
  }
  return spread(f);
}

/** The serving side at the moment of the serve: the server behind the
 *  baseline, the front row at the net and the back row in their zones. */
function serveFormation(t: Team): Formation {
  const f: Formation = new Map();
  for (let z = 0; z < 6; z++) {
    const c = column(z);
    if (z === 0) f.set(t.zones[z], { u: 0.84, v: 1.06 });
    else f.set(t.zones[z], { u: LANE_U[c], v: isFrontRow(z) ? 0.16 : 0.62 });
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
  for (const [p, lane] of assignLanes(front, (p) => FRONT_LANE[t.role(p)])) {
    f.set(p, { u: LANE_U[lane], v: 0.14 });
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
  const frontSpot = [{ u: 0.08, v: 0.36 }, { u: 0.48, v: 0.24 }, { u: 0.92, v: 0.36 }];
  const backSpot = [{ u: 0.24, v: 0.56 }, { u: 0.5, v: 0.64 }, { u: 0.84, v: 0.64 }];
  for (const [p, lane] of assignLanes(front, (p) => FRONT_LANE[t.role(p)])) f.set(p, { ...frontSpot[lane] });
  for (const [p, lane] of assignLanes(back, (p) => BACK_LANE[t.role(p)])) f.set(p, { ...backSpot[lane] });
  return f;
}

/** The hit itself: the attacker at their contact point, team-mates closing
 *  in underneath to cover a block. */
function attackFormation(t: Team, attacker: number, lane: string | undefined): { f: Formation; hit: Local } {
  const f = offenceFormation(t);
  const hit = (lane !== undefined ? HIT_POINT[lane] : undefined)
    ?? { u: f.get(attacker)?.u ?? 0.5, v: 0.05 };
  for (const [p, l] of f) {
    if (p === attacker || p === t.setter) continue;
    f.set(p, { u: l.u + (hit.u - l.u) * 0.3, v: Math.max(0.3, l.v * 0.85) });
  }
  f.set(attacker, { ...hit });
  return { f, hit };
}

/** Defending an attack aimed from `hitU` (in this team's own frame): the two
 *  closest front-row players close the block on the hitter, the back row sets
 *  up a perimeter shaded towards the ball. */
function blockFormation(t: Team, hitU: number): Formation {
  const f = defenceFormation(t);
  const front = t.zones
    .filter((_, z) => isFrontRow(z))
    .sort((a, b) => Math.abs((f.get(a)?.u ?? 0.5) - hitU) - Math.abs((f.get(b)?.u ?? 0.5) - hitU));
  const target = Math.min(0.9, Math.max(0.1, hitU));
  front.forEach((p, i) => {
    if (i === 0) f.set(p, { u: target - 0.07, v: 0.08 });
    else if (i === 1) f.set(p, { u: target + 0.07, v: 0.08 });
    else f.set(p, { u: f.get(p)?.u ?? 0.5, v: 0.14 });
  });
  const perimeter = [{ u: 0.14, v: 0.7 }, { u: 0.5, v: 0.88 }, { u: 0.86, v: 0.7 }];
  const back = t.zones.filter((_, z) => !isFrontRow(z));
  for (const [p, lane] of assignLanes(back, (p) => BACK_LANE[t.role(p)])) {
    const spot = perimeter[lane];
    f.set(p, { u: spot.u + (hitU - spot.u) * 0.15, v: spot.v });
  }
  return spread(f);
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

/** A fresh formation per side: the serving side ready to serve, the other ready to pass. */
function openingFormations(teams: [Team, Team], serving: 0 | 1): [Formation, Formation] {
  const forms: [Formation, Formation] = [new Map(), new Map()];
  forms[serving] = serveFormation(teams[serving]);
  forms[1 - serving] = receiveFormation(teams[1 - serving]);
  return forms;
}

function teamsOf(court: CourtState, positions: Uint8Array): [Team, Team] {
  return [
    buildTeam('home', court.homeCourt, court.homeLibero, positions),
    buildTeam('away', court.awayCourt, court.awayLibero, positions),
  ];
}

function toPositions(teams: [Team, Team], forms: [Formation, Formation]): Map<number, Pt> {
  const out = new Map<number, Pt>();
  for (const t of [0, 1] as const) {
    for (const [p, l] of forms[t]) out.set(p, toScreen(teams[t].side, l));
  }
  return out;
}

/** The ball sits just above a player's head rather than hidden under their face. */
function ballAt(side: Side, l: Local): Pt {
  const pt = toScreen(side, l);
  return { x: pt.x + 2.5, y: pt.y - 3.5 };
}

/** The court between rallies: both sides set up for the next serve, the ball
 *  in the server's hand. */
export function setupScene(court: CourtState, serving: 0 | 1, positions: Uint8Array): Scene {
  const teams = teamsOf(court, positions);
  const forms = openingFormations(teams, serving);
  const server = teams[serving].zones[0];
  const hand = forms[serving].get(server);
  return {
    positions: toPositions(teams, forms),
    ball: hand !== undefined ? ballAt(teams[serving].side, hand) : null,
    high: false,
    actor: null,
    ms: 700,
  };
}

/**
 * Script one logged rally as a sequence of beats — where every player is and
 * where the ball goes at each contact. `court` is the arrangement the rally
 * was played in; `seed` just varies where unreturned balls land.
 */
export function rallyBeats(
  court: CourtState,
  serveTeam: 0 | 1,
  contacts: readonly RallyContact[],
  positions: Uint8Array,
  seed: number,
): Beat[] {
  const teams = teamsOf(court, positions);
  const forms = openingFormations(teams, serveTeam);
  const beats: Beat[] = [];
  const at = (t: 0 | 1, p: number): Local => forms[t].get(p) ?? { u: 0.5, v: 0.5 };
  const ball = (t: 0 | 1, l: Local): Pt => ballAt(teams[t].side, l);
  const push = (
    b: Pt, actor: number | null, ms: number, high = false,
    callout: Beat['callout'] = null,
  ): void => {
    beats.push({ positions: toPositions(teams, forms), ball: b, high, actor, ms, callout });
  };

  // The side that has just passed or dug still has to set before it can hit.
  let needsSet = false;
  const setBall = (t: 0 | 1): void => {
    forms[t] = offenceFormation(teams[t]);
    const setter = teams[t].setter;
    push(ball(t, setter >= 0 ? at(t, setter) : TARGET), setter >= 0 ? setter : null, 430, true);
    needsSet = false;
  };

  contacts.forEach((c, i) => {
    const t = c.team;
    const o = (1 - t) as 0 | 1;
    switch (c.kind) {
      case 'serve':
        push(ball(t, at(t, c.player)), c.player, 420);
        break;
      case 'serveError': {
        const from = at(t, c.player);
        push(ball(t, from), c.player, 380);
        push(ball(t, { u: from.u, v: 0.01 }), null, 560, true, { kind: 'serveError', team: o });
        break;
      }
      case 'ace':
        forms[t] = defenceFormation(teams[t]);
        push(ball(o, holeIn(forms[o], seed)), null, 640, true, { kind: 'ace', team: t });
        break;
      case 'reception':
      case 'receptionError': {
        // The serving side switches into its specialist spots as the serve crosses.
        forms[o] = defenceFormation(teams[o]);
        const pass = at(t, c.player);
        push(ball(t, pass), c.player, 640, true);
        if (c.kind === 'receptionError') {
          push(ball(t, { u: pass.u < 0.5 ? -0.08 : 1.08, v: Math.min(1.05, pass.v + 0.25) }), null, 480);
        } else {
          needsSet = true;
        }
        break;
      }
      case 'setError': {
        setBall(t);
        const from = teams[t].setter >= 0 ? at(t, teams[t].setter) : TARGET;
        push(ball(t, { u: from.u, v: 0.28 }), null, 420);
        break;
      }
      case 'freeball': {
        setBall(t);
        forms[t] = defenceFormation(teams[t]);
        const catcher = teams[o].zones.find((p) => teams[o].role(p) === Position.Libero)
          ?? teams[o].passers[0] ?? teams[o].zones[5];
        push(ball(o, at(o, catcher)), catcher, 600, true);
        needsSet = true;
        break;
      }
      case 'attack':
      case 'kill':
      case 'attackError':
      case 'blocked': {
        if (needsSet) setBall(t);
        const { f, hit } = attackFormation(teams[t], c.player, c.detail);
        forms[t] = f;
        forms[o] = blockFormation(teams[o], 1 - hit.u);
        push(ball(t, hit), c.player, 380);
        if (c.kind === 'kill') {
          push(ball(o, holeIn(forms[o], seed + i)), null, 460, false, { kind: 'kill', team: t });
        } else if (c.kind === 'attackError') {
          push(ball(o, { u: Math.min(0.95, Math.max(0.05, 1 - hit.u)), v: 1.08 }), null, 460, false,
            { kind: 'attackError', team: o });
        } else if (c.kind === 'blocked') {
          const blocker = teams[o].zones
            .filter((_, z) => isFrontRow(z))
            .sort((a, b) => Math.abs(at(o, a).u - (1 - hit.u)) - Math.abs(at(o, b).u - (1 - hit.u)))[0];
          if (blocker !== undefined) push(ball(o, at(o, blocker)), blocker, 260, false, { kind: 'blocked', team: o });
          push(ball(t, { u: hit.u, v: 0.22 }), null, 420);
        }
        break;
      }
      case 'blockTouch':
        push(ball(t, at(t, c.player)), c.player, 260);
        break;
      case 'dig':
      case 'digError': {
        push(ball(t, at(t, c.player)), c.player, 440, true);
        // The side that just attacked recovers into its defence.
        forms[o] = defenceFormation(teams[o]);
        if (c.kind === 'dig') needsSet = true;
        else push(ball(t, { u: at(t, c.player).u, v: 1.06 }), null, 420);
        break;
      }
      default:
        break;
    }
  });
  return beats;
}
