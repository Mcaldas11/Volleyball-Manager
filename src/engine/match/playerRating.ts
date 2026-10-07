/**
 * Player match ratings, on the familiar 0-10 scale.
 *
 * A rating is read straight off a player's box-score line, so the same
 * function rates a match in progress (the live viewer calls it after every
 * rally) and a finished one, whether it was played through the full rally
 * engine or a background quick-sim.
 *
 * Every contact is worth something: a kill or an ace adds, an error or a
 * shanked pass takes away. That value is expressed per set's worth of rallies
 * actually spent on court, measured against what an average player *in the
 * same position* produces — a libero is never going to out-score an opposite,
 * so comparing them on raw volume would make every libero a 5.5.
 *
 * Everyone starts a match on 6.0 and moves from there. An ordinary night ends
 * close to it; a good one around 7; an 8 is a match to remember, and the
 * scale tightens the further it climbs, so a 9 is one in thousands — or the
 * other way, for a night to forget. Early in a match, or for a substitute who
 * played a handful of rallies, the rating stays near 6.0 until there is
 * enough evidence to move it. The scoreline nudges everyone: winning sides
 * rate a little higher.
 *
 * Matches played through the full rally engine and background quick-sims fill
 * in the same statistics, but not with the same shape — so each has its own
 * yardstick, and the same spread: a 7.0 means the same in a league the
 * manager watches as in one he never sees.
 */

import { Position } from '../model/positions.ts';
import type { PlayerMatchStats } from './stats.ts';

/** Where every player starts a match, and where an unremarkable one ends it. */
export const NEUTRAL_RATING = 6.0;

/** Where each colour band of the scale starts: a standout night is one in fifty, a great one one in ten. */
export const RATING_BANDS = { star: 7.8, great: 7.0, good: 6.4, ok: 5.8, poor: 5.2 } as const;

/** Which engine a match was played through: the full rally engine, or the background quick-sim. */
export type RatingPath = 'full' | 'quick';

/** Rallies that count as "one set's worth" of court time. */
const RALLIES_PER_SET = 45;

/** Rallies of evidence at which a rating has moved halfway from neutral. */
const EVIDENCE_HALF = 22;

/**
 * Average value per set for each position on each path, measured across
 * thousands of simulated matches — with the coaches' own tactics — so an
 * ordinary performance in any role sits at {@link NEUTRAL_RATING}. Re-measure
 * with `npm run vm ratings` if the weights below or either engine change.
 */
const POSITION_BASELINE: Readonly<Record<RatingPath, Readonly<Record<Position, number>>>> = {
  full: {
    [Position.Setter]: 1.89,
    [Position.Opposite]: 2.68,
    [Position.OutsideHitter]: 1.76,
    [Position.MiddleBlocker]: 1.93,
    [Position.Libero]: 2.51,
  },
  quick: {
    [Position.Setter]: 1.78,
    [Position.Opposite]: 2.62,
    [Position.OutsideHitter]: 2.62,
    [Position.MiddleBlocker]: 2.18,
    [Position.Libero]: 3.14,
  },
};

/**
 * Rating points per unit of value above that average, per set. Outsides touch
 * the ball far more than anyone else — they attack and pass — so the same
 * scale would swing their ratings twice as hard as a setter's; each role is
 * scaled so a good or bad night moves every position by a similar amount.
 */
const POSITION_SCALE: Readonly<Record<Position, number>> = {
  [Position.Setter]: 0.68,
  [Position.Opposite]: 0.5,
  [Position.OutsideHitter]: 0.34,
  [Position.MiddleBlocker]: 0.5,
  [Position.Libero]: 0.58,
};

/**
 * How far a performance moves a rating on each path: a quick-sim box score
 * varies less from night to night than a match played rally by rally, so its
 * swings are widened to the same spread — a rating's standard deviation about
 * 0.75 either way.
 */
const PATH_SPREAD: Readonly<Record<RatingPath, number>> = { full: 0.66, quick: 1.6 };

/** The furthest a performance can carry a rating from 6.0, approached ever more slowly. */
const RATING_REACH = 3.0;

/** Total value of one stat line, before any normalisation. */
export function ratingValue(s: PlayerMatchStats): number {
  return (
    s.attackKills * 1.0
    + s.serveAces * 1.3
    + s.blockPoints * 1.3
    + s.blockTouches * 0.25
    - s.attackErrors * 1.1
    - s.attackBlocked * 0.9
    - s.serveErrors * 0.7
    - s.receptionErrors * 1.1
    + s.receptionPerfect * 0.35
    + s.receptionPositive * 0.15
    - s.receptionPoor * 0.3
    + s.digsTotal * 0.35
    - s.digErrors * 0.5
    + s.setAssists * 0.12
    - s.setErrors * 1.1
  );
}

/** Whether a stat line shows the player actually took part. */
export function playedInMatch(s: PlayerMatchStats): boolean {
  return s.ralliesPlayed > 0 || s.attacksTotal > 0 || s.servesTotal > 0 || s.receptionsTotal > 0;
}

/**
 * A player's rating for a match, 1.0-10.0 to one decimal. `setsFor` and
 * `setsAgainst` are from the player's own team's point of view — mid-match,
 * pass the sets won so far. `path` is the engine the match was played through.
 */
export function matchRating(
  s: PlayerMatchStats,
  position: Position,
  setsFor: number,
  setsAgainst: number,
  path: RatingPath = 'full',
): number {
  const rallies = Math.max(s.ralliesPlayed, 1);
  const perSet = (ratingValue(s) / rallies) * RALLIES_PER_SET;
  const evidence = s.ralliesPlayed / (s.ralliesPlayed + EVIDENCE_HALF);
  const raw = (perSet - POSITION_BASELINE[path][position]) * POSITION_SCALE[position] * PATH_SPREAD[path] * evidence;
  // The further from 6.0, the harder each step: a great night is an 8, not a 10.
  const performance = RATING_REACH * Math.tanh(raw / RATING_REACH);
  const result = Math.max(-0.45, Math.min(0.45, (setsFor - setsAgainst) * 0.15)) * evidence;
  const rating = NEUTRAL_RATING + performance + result;
  return Math.round(Math.max(1, Math.min(10, rating)) * 10) / 10;
}
