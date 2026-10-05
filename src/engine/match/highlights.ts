/**
 * The rallies worth showing again.
 *
 * A match the engine is asked to watch for them keeps its best point and its
 * best play: the point a single stroke of brilliance — a spike struck at
 * full speed, a hitter stuffed by the block, an ace — and the play a rally
 * that went on, attack after attack dug up, until someone finally put it
 * away. Each is rated for how good it was and for what rode on it: late in a
 * set, a set point, a match point. Every candidate carries the rally whole —
 * the court as it stood, who played where, every contact — so it can be
 * played out again on the live court, the way a month's best are.
 */

import type { RallyContact } from './engine.ts';

export type HighlightKind = 'point' | 'play';
export type HighlightWhat = 'spike' | 'block' | 'ace' | 'rally';

export interface Highlight {
  kind: HighlightKind;
  /** What it was: the stroke for a point, a rally for a play. */
  what: HighlightWhat;
  /** How good it was, for ranking a month's candidates. */
  score: number;
  /** Zero-based set it came in, and how things stood before it. */
  set: number;
  scoreBefore: [number, number];
  setsBefore: [number, number];
  /** Points to win the set — 15 in a decider. */
  setTarget: number;
  serveTeam: 0 | 1;
  winner: 0 | 1;
  /** The court as it stood: who was in each rotational zone, and the liberos. */
  homeCourt: number[];
  awayCourt: number[];
  homeLibero: number;
  awayLibero: number;
  /** The position each of those players was playing. */
  roles: Array<[player: number, position: number]>;
  contacts: RallyContact[];
  /** Whose it was — the hitter, the blocker, the server — and his side. */
  star: number;
  starTeam: 0 | 1;
  /** The ball's speed off the hand, km/h — for a spike or a serve. */
  speed?: number;
  /** Attacks and digs in the rally. */
  attacks: number;
  digs: number;
  /** Filled in once the match goes on the record. */
  fixtureId?: number;
  competitionId?: number;
  day?: number;
  home?: number;
  away?: number;
}

/** A spike this fast that ends the rally is a monster: it gets the big callout and its speed shown. */
export const MONSTER_SPIKE_KMH = 114;

/** How much rode on a rally: late in the set, a set point, a deuce, a match point. */
export function pressureOf(
  scoreBefore: readonly [number, number], setsBefore: readonly [number, number], setTarget: number, setsToWin: number,
): number {
  const [a, b] = scoreBefore;
  let p = Math.max(a, b) >= setTarget - 4 ? 0.4 : 0;
  const setPoint = (s: number, o: number): boolean => s >= setTarget - 1 && s > o;
  const sp: [boolean, boolean] = [setPoint(a, b), setPoint(b, a)];
  if (sp[0] || sp[1]) {
    p += 0.8;
    if ((sp[0] && setsBefore[0] === setsToWin - 1) || (sp[1] && setsBefore[1] === setsToWin - 1)) p += 0.7;
  }
  if (a >= setTarget - 1 && b >= setTarget - 1) p += 0.4;
  return p;
}

const ATTACKS: ReadonlySet<RallyContact['kind']> = new Set(['attack', 'kill', 'blocked', 'attackError']);

export interface RallyRating {
  what: HighlightWhat;
  score: number;
  star: number;
  starTeam: 0 | 1;
  speed?: number;
}

/**
 * Rate a finished rally as a point and as a play: null where it is neither.
 * Errors are never highlights; `pressure` is what rode on it and `luck` a
 * little something to split near-equals.
 */
export function rateRally(
  contacts: readonly RallyContact[], pressure: number, luck: number,
): { point: RallyRating | null; play: RallyRating | null; attacks: number; digs: number } {
  let attacks = 0;
  let digs = 0;
  for (const c of contacts) {
    if (ATTACKS.has(c.kind)) attacks++;
    else if (c.kind === 'dig') digs++;
  }
  const last = contacts[contacts.length - 1];
  if (last === undefined) return { point: null, play: null, attacks, digs };

  let point: RallyRating | null = null;
  if (last.kind === 'kill') {
    const speed = last.speed ?? 100;
    const backRow = last.detail === 'Pipe' || last.detail === 'Back-row right';
    point = {
      what: 'spike', star: last.player, starTeam: last.team, speed,
      score: 1 + Math.max(0, speed - 100) * 0.12 + (backRow ? 0.3 : 0) + (attacks >= 2 ? 0.3 : 0),
    };
  } else if (last.kind === 'blocked' && last.by !== undefined) {
    point = { what: 'block', star: last.by, starTeam: (1 - last.team) as 0 | 1, speed: last.speed, score: 2.1 };
  } else if (last.kind === 'ace') {
    const serve = contacts.find((c) => c.kind === 'serve');
    const speed = serve?.speed;
    point = {
      what: 'ace', star: last.player, starTeam: last.team, speed,
      score: 1.5 + Math.max(0, (speed ?? 0) - 100) * 0.1,
    };
  }
  if (point !== null) point.score += pressure + luck;

  let play: RallyRating | null = null;
  if (attacks >= 3 && point !== null && point.what !== 'ace') {
    // Its speed is the finishing spike's — none for a rally ended by a block.
    play = {
      what: 'rally', star: point.star, starTeam: point.starTeam, speed: point.what === 'spike' ? point.speed : undefined,
      score: attacks * 0.85 + digs * 0.6 + (point.what === 'block' ? 0.3 : 0) +
        Math.max(0, (point.speed ?? 100) - 105) * 0.05 + pressure + luck,
    };
  }
  return { point, play, attacks, digs };
}

/** Keep the best `max` of a list, best first — a new candidate in, the weakest out. */
export function keepBest(list: Highlight[], h: Highlight, max: number): void {
  list.push(h);
  list.sort((a, b) => b.score - a.score);
  if (list.length > max) list.length = max;
}

/** The same rally, whichever list it turns up in. */
export function sameRally(a: Highlight, b: Highlight): boolean {
  return a.fixtureId === b.fixtureId && a.set === b.set &&
    a.scoreBefore[0] === b.scoreBefore[0] && a.scoreBefore[1] === b.scoreBefore[1];
}
