/**
 * Quick simulation.
 *
 * The full rally engine costs roughly a millisecond per match. That is fine
 * for the matches a user cares about, but a single season across every
 * division in the world is over a hundred thousand matches, and a fifty-season
 * career is five million. Simulating all of them contact-by-contact would take
 * hours.
 *
 * So background matches run a point-level Markov simulation instead: the same
 * side-out structure, the same scoring rules, the same set formats, but with
 * each rally resolved by a single Bernoulli draw rather than by a full
 * serve-reception-set-attack-block-dig sequence. Set scores, match lengths and
 * five-set rates come out looking the same because they are produced by the
 * same process at a coarser grain.
 *
 * The side-out probabilities are derived from squad ability and checked
 * against the full engine by `npm run vm compare`, so a club's results do not
 * change depending on whether the user happened to be watching.
 */

import type { Rng } from '../core/rng.ts';
import { MatchFormat } from '../match/engine.ts';
import type { PlayerStore } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import { newPlayerStats } from '../match/stats.ts';

/**
 * Baseline side-out rate for evenly matched sides, taken from the calibrated
 * full engine.
 */
const SIDE_OUT_BASE = 0.617;

/**
 * How much a squad-ability gap moves the side-out rate. Fixed by comparing
 * match win rates against the full engine across a range of ability gaps.
 */
const ABILITY_TO_SIDE_OUT = 0.42;

export interface QuickResult {
  homeSets: number;
  awaySets: number;
  setScores: Array<[number, number]>;
  homeStats: Map<number, PlayerMatchStats>;
  awayStats: Map<number, PlayerMatchStats>;
  mvp: number;
}

/**
 * Effective strength of a starting seven.
 *
 * Weighted toward the positions that touch the ball most: the setter runs
 * every offensive sequence and the libero handles most of the defence, so
 * their quality counts for more per head than a middle's.
 */
export function squadStrength(
  store: PlayerStore,
  lineup: number[],
  libero: number,
): number {
  let total = 0;
  let weight = 0;
  for (const p of lineup) {
    if (p === undefined || p < 0) continue;
    const pos = store.position[p] as Position;
    const w = pos === Position.Setter ? 1.35 : pos === Position.MiddleBlocker ? 0.85 : 1.0;
    // Condition and morale carry into strength, so a tired squad is genuinely
    // weaker in the background sim too.
    const state = 0.88 + 0.09 * (store.condition[p] / 100) + 0.03 * (store.morale[p] / 100);
    total += store.currentAbility[p] * w * state;
    weight += w;
  }
  if (libero >= 0) {
    const state = 0.88 + 0.12 * (store.condition[libero] / 100);
    total += store.currentAbility[libero] * 1.1 * state;
    weight += 1.1;
  }
  return weight > 0 ? total / weight : 800;
}

/**
 * Simulate a match point by point.
 */
export function quickSimulate(
  store: PlayerStore,
  home: { lineup: number[]; libero: number },
  away: { lineup: number[]; libero: number },
  format: MatchFormat,
  rng: Rng,
  homeAdvantage = true,
): QuickResult {
  const sh = squadStrength(store, home.lineup, home.libero);
  const sa = squadStrength(store, away.lineup, away.libero);

  // Ability gap expressed as a fraction of the full ability scale, then
  // converted into a side-out edge shared symmetrically between the sides.
  const gap = (sh - sa) / 2000;
  const edge = gap * ABILITY_TO_SIDE_OUT;
  const homeBonus = homeAdvantage ? 0.012 : 0;

  const pHome = clamp(SIDE_OUT_BASE + edge + homeBonus, 0.30, 0.88);
  const pAway = clamp(SIDE_OUT_BASE - edge - homeBonus, 0.30, 0.88);

  const setsToWin = format === MatchFormat.BestOf5 ? 3 : format === MatchFormat.BestOf3 ? 2 : 1;
  const maxSets = format === MatchFormat.BestOf5 ? 5 : format === MatchFormat.BestOf3 ? 3 : 1;

  const setScores: Array<[number, number]> = [];
  let homeSets = 0;
  let awaySets = 0;
  let serving = rng.chance(0.5) ? 0 : 1;
  let totalRallies = 0;

  while (homeSets < setsToWin && awaySets < setsToWin && setScores.length < maxSets) {
    const decider =
      (format === MatchFormat.BestOf5 && setScores.length === 4) ||
      (format === MatchFormat.BestOf3 && setScores.length === 2) ||
      format === MatchFormat.GoldenSet;
    const target = decider ? 15 : 25;

    let h = 0;
    let a = 0;
    for (;;) {
      const receiving = 1 - serving;
      const pRecv = receiving === 0 ? pHome : pAway;
      totalRallies++;
      if (rng.float() < pRecv) {
        if (receiving === 0) h++;
        else a++;
        serving = receiving;
      } else {
        if (serving === 0) h++;
        else a++;
      }
      if ((h >= target || a >= target) && Math.abs(h - a) >= 2) break;
      if (h > target + 25 || a > target + 25) break;
    }

    setScores.push([h, a]);
    if (h > a) homeSets++;
    else awaySets++;
    serving = setScores.length % 2 === 0 ? 1 : 0;
  }

  const homePoints = setScores.reduce((s, [h]) => s + h, 0);
  const awayPoints = setScores.reduce((s, [, a]) => s + a, 0);

  const homeStats = allocateStats(store, home.lineup, home.libero, homePoints, totalRallies, rng);
  const awayStats = allocateStats(store, away.lineup, away.libero, awayPoints, totalRallies, rng);

  return {
    homeSets,
    awaySets,
    setScores,
    homeStats,
    awayStats,
    mvp: pickMvp(homeSets > awaySets ? homeStats : awayStats),
  };
}

/**
 * Spread a team's points across its players.
 *
 * Without this, background matches would leave season statistics empty and the
 * scoring charts would only ever show the user's own league. The split follows
 * the real shape of a box score: opposites and outsides take most of the
 * swings, middles score fewer but block more, and roughly a fifth of a team's
 * points come from opponent errors and belong to nobody.
 */
function allocateStats(
  store: PlayerStore,
  lineup: number[],
  libero: number,
  teamPoints: number,
  rallies: number,
  rng: Rng,
): Map<number, PlayerMatchStats> {
  const out = new Map<number, PlayerMatchStats>();
  const players = [...lineup.filter((p) => p >= 0)];
  if (libero >= 0) players.push(libero);
  if (players.length === 0) return out;

  for (const p of players) out.set(p, newPlayerStats(p));

  // Points that came from the opponent making a mistake are not credited.
  const earned = Math.round(teamPoints * rng.range(0.76, 0.86));
  const aces = Math.round(earned * rng.range(0.06, 0.11));
  const blocks = Math.round(earned * rng.range(0.10, 0.16));
  const kills = Math.max(0, earned - aces - blocks);

  // Attack share by position and ability.
  const attackWeight = (p: number): number => {
    const pos = store.position[p] as Position;
    const base =
      pos === Position.Opposite ? 1.5 :
      pos === Position.OutsideHitter ? 1.35 :
      pos === Position.MiddleBlocker ? 0.75 :
      pos === Position.Setter ? 0.12 : 0.02;
    return base * (store.currentAbility[p] / 1000);
  };
  const blockWeight = (p: number): number => {
    const pos = store.position[p] as Position;
    const base =
      pos === Position.MiddleBlocker ? 2.0 :
      pos === Position.Opposite ? 1.0 :
      pos === Position.OutsideHitter ? 0.8 :
      pos === Position.Setter ? 0.5 : 0.0;
    return base * (store.currentAbility[p] / 1000);
  };

  distribute(players, kills, attackWeight, rng, (p, n) => {
    const s = out.get(p)!;
    s.attackKills += n;
    // Back out a plausible attempt count from the calibrated kill rate.
    s.attacksTotal += Math.round(n / 0.51);
    s.attackErrors += Math.round(s.attacksTotal * 0.10);
    s.attackBlocked += Math.round(s.attacksTotal * 0.074);
  });
  distribute(players, blocks, blockWeight, rng, (p, n) => {
    out.get(p)!.blockPoints += n;
  });
  distribute(players, aces, () => 1, rng, (p, n) => {
    const s = out.get(p)!;
    s.serveAces += n;
    s.servesTotal += Math.round(n / 0.063);
    s.serveErrors += Math.round(s.servesTotal * 0.108);
  });

  // Reception and digs, so passing statistics are not blank either.
  for (const p of players) {
    const pos = store.position[p] as Position;
    const s = out.get(p)!;
    s.ralliesPlayed = rallies;
    if (pos === Position.Libero || pos === Position.OutsideHitter) {
      s.receptionsTotal = Math.round((rallies / 3) * rng.range(0.8, 1.2));
      s.receptionPerfect = Math.round(s.receptionsTotal * 0.427);
      s.receptionPositive = Math.round(s.receptionsTotal * 0.238);
      s.receptionPoor = Math.round(s.receptionsTotal * 0.29);
      s.receptionErrors = s.receptionsTotal - s.receptionPerfect - s.receptionPositive - s.receptionPoor;
    }
    if (pos === Position.Libero) s.digsTotal = Math.round(rallies * rng.range(0.20, 0.32));
    else if (pos !== Position.MiddleBlocker) s.digsTotal = Math.round(rallies * rng.range(0.05, 0.14));
    if (pos === Position.Setter) s.setAssists = Math.round(teamPoints * 0.5);
  }

  // Career totals must be updated here too, or a player's record would depend
  // on whether their matches happened to be watched.
  for (const [p, s] of out) {
    store.careerMatches[p] = Math.min(65535, store.careerMatches[p] + 1);
    store.careerPoints[p] += s.attackKills + s.serveAces + s.blockPoints;
    store.careerAces[p] = Math.min(65535, store.careerAces[p] + s.serveAces);
    store.careerBlocks[p] = Math.min(65535, store.careerBlocks[p] + s.blockPoints);
  }
  return out;
}

function distribute(
  players: number[],
  total: number,
  weightOf: (p: number) => number,
  rng: Rng,
  apply: (p: number, n: number) => void,
): void {
  if (total <= 0) return;
  const weights = players.map(weightOf);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return;
  let remaining = total;
  for (let i = 0; i < players.length && remaining > 0; i++) {
    const share = i === players.length - 1
      ? remaining
      : Math.min(remaining, Math.round((weights[i] / sum) * total * rng.range(0.85, 1.15)));
    if (share > 0) apply(players[i], share);
    remaining -= share;
  }
}

function pickMvp(stats: Map<number, PlayerMatchStats>): number {
  let best = -1;
  let bestScore = -Infinity;
  for (const [p, s] of stats) {
    const score = s.attackKills + s.serveAces * 1.4 + s.blockPoints * 1.3;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
