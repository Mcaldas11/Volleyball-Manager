/**
 * Player match ratings, on the familiar 0-10 scale.
 *
 * A rating is read straight off a player's box-score line, so the same
 * function rates a match in progress (the live viewer calls it after every
 * rally) and a finished one, and it works identically for matches played
 * through the full rally engine and for background quick-sims — both fill in
 * the same statistics.
 *
 * Every contact is worth something: a kill or an ace adds, an error or a
 * shanked pass takes away. That value is expressed per set's worth of rallies
 * actually spent on court, measured against what an average player *in the
 * same position* produces — a libero is never going to out-score an opposite,
 * so comparing them on raw volume would make every libero a 5.5. Early in a
 * match, or for a substitute who played a handful of rallies, the rating is
 * pulled toward the neutral mark until there is enough evidence to move it.
 * Finally, the scoreline nudges everyone: winning sides rate a little higher.
 */

import { Position } from '../model/positions.ts';
import type { PlayerMatchStats } from './stats.ts';

/** Where a player with an unremarkable match lands. */
export const NEUTRAL_RATING = 6.4;

/** Rallies that count as "one set's worth" of court time. */
const RALLIES_PER_SET = 45;

/** Rallies of evidence at which a rating has moved halfway from neutral. */
const EVIDENCE_HALF = 22;

/**
 * Average value per set for each position, measured across thousands of
 * simulated matches so an ordinary performance in any role sits at
 * {@link NEUTRAL_RATING}. Re-measure with `npm run vm ratings` if the
 * weights below or the match engine change.
 */
const POSITION_BASELINE: Readonly<Record<Position, number>> = {
  [Position.Setter]: 1.84,
  [Position.Opposite]: 2.25,
  [Position.OutsideHitter]: 2.19,
  [Position.MiddleBlocker]: 2.05,
  [Position.Libero]: 3.25,
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
 * pass the sets won so far.
 */
export function matchRating(
  s: PlayerMatchStats,
  position: Position,
  setsFor: number,
  setsAgainst: number,
): number {
  const rallies = Math.max(s.ralliesPlayed, 1);
  const perSet = (ratingValue(s) / rallies) * RALLIES_PER_SET;
  const evidence = s.ralliesPlayed / (s.ralliesPlayed + EVIDENCE_HALF);
  const performance = (perSet - POSITION_BASELINE[position]) * POSITION_SCALE[position] * evidence;
  const result = Math.max(-0.45, Math.min(0.45, (setsFor - setsAgainst) * 0.15)) * evidence;
  const rating = NEUTRAL_RATING + performance + result;
  return Math.round(Math.max(1, Math.min(10, rating)) * 10) / 10;
}
