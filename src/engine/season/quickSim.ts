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

  const homeStats = allocateStats(store, home.lineup, home.libero, homePoints, totalRallies, sh, rng);
  const awayStats = allocateStats(store, away.lineup, away.libero, awayPoints, totalRallies, sa, rng);

  return {
    homeSets,
    awaySets,
    setScores,
    homeStats,
    awayStats,
    mvp: pickMvp(homeSets > awaySets ? homeStats : awayStats),
  };
}

/** Share of a team's attack swings, digs and receptions each role takes in the
 *  full engine — measured, not assumed, so a background box score has the
 *  same shape as one the user watched (see `npm run vm ratings`). */
const KILL_SHARE: Readonly<Record<Position, number>> = {
  [Position.OutsideHitter]: 1.0,
  [Position.Opposite]: 0.7,
  [Position.MiddleBlocker]: 0.4,
  [Position.Setter]: 0,
  [Position.Libero]: 0,
};
const BLOCK_SHARE: Readonly<Record<Position, number>> = {
  [Position.MiddleBlocker]: 1.3,
  [Position.Opposite]: 1.2,
  [Position.OutsideHitter]: 1.0,
  [Position.Setter]: 0.9,
  [Position.Libero]: 0,
};
const RECEPTION_SHARE: Readonly<Record<Position, number>> = {
  [Position.OutsideHitter]: 0.33,
  [Position.Libero]: 0.22,
  [Position.MiddleBlocker]: 0.035,
  [Position.Opposite]: 0.02,
  [Position.Setter]: 0.015,
};
const DIG_SHARE: Readonly<Record<Position, number>> = {
  [Position.Libero]: 0.40,
  [Position.Setter]: 0.14,
  [Position.OutsideHitter]: 0.13,
  [Position.Opposite]: 0.125,
  [Position.MiddleBlocker]: 0.047,
};

/** A count drawn around `mean`, spread roughly the way small match samples are. */
function jitter(mean: number, rng: Rng, spread = 0.5): number {
  return Math.max(0, Math.round(mean * rng.range(1 - spread, 1 + spread)));
}

/**
 * Spread a team's points across its players.
 *
 * Without this, background matches would leave season statistics empty, the
 * scoring charts would only ever show the user's own league, and players
 * outside it could never earn a match rating. Rates and volumes follow what
 * the full rally engine produces for a side of the same strength: stronger
 * squads kill more of their swings and pass better, liberos and middles share
 * the back row, and only the six rotating players serve.
 */
function allocateStats(
  store: PlayerStore,
  lineup: number[],
  libero: number,
  teamPoints: number,
  rallies: number,
  strength: number,
  rng: Rng,
): Map<number, PlayerMatchStats> {
  const out = new Map<number, PlayerMatchStats>();
  const players = [...lineup.filter((p) => p >= 0)];
  if (libero >= 0) players.push(libero);
  if (players.length === 0) return out;
  const servers = players.filter((p) => store.position[p] !== Position.Libero);
  const posOf = (p: number): Position => store.position[p] as Position;

  for (const p of players) out.set(p, newPlayerStats(p));

  // 0 for a weak lower-division side, 1 for an elite one.
  const level = clamp((strength - 750) / 750, 0, 1);
  const killRate = 0.30 + 0.20 * level;
  const attackErrorRate = 0.14 - 0.05 * level;
  const blockedRate = 0.078 - 0.02 * level;
  const perfectShare = 0.31 + 0.14 * level;
  const positiveShare = 0.28 - 0.05 * level;
  const receptionErrorShare = 0.068;

  // Points that came from the opponent making a mistake are not credited.
  const earned = Math.round(teamPoints * (rng.range(0.55, 0.65) + 0.08 * level));
  const aces = Math.round(earned * rng.range(0.07, 0.11));
  const blocks = Math.round(earned * rng.range(0.12, 0.17));
  const kills = Math.max(0, earned - aces - blocks);

  const ability = (p: number): number => store.currentAbility[p] / 1000;
  // How a player measures up against their own side: the team's star hits
  // cleaner and passes better than its weakest link, as on court.
  const relative = (p: number): number => clamp(store.currentAbility[p] / Math.max(1, strength), 0.75, 1.25);
  distribute(players, kills, (p) => KILL_SHARE[posOf(p)] * ability(p), rng, (p, n) => {
    const s = out.get(p)!;
    const rel = relative(p);
    s.attackKills += n;
    // Back out an attempt count from the side's kill rate; individual
    // efficiency varies match to match exactly as it does on court.
    s.attacksTotal += Math.round(n / (killRate * rel ** 1.5 * rng.range(0.78, 1.22)));
    s.attackErrors += jitter((s.attacksTotal * attackErrorRate) / rel ** 2, rng, 0.6);
    s.attackBlocked += jitter((s.attacksTotal * blockedRate) / rel, rng, 0.6);
  });
  distribute(players, blocks, (p) => BLOCK_SHARE[posOf(p)] * ability(p), rng, (p, n) => {
    out.get(p)!.blockPoints += n;
  });
  // Only the six rotating players ever serve — never the libero.
  const teamServes = Math.round(rallies * 0.5);
  for (const p of servers) {
    const s = out.get(p)!;
    s.servesTotal = jitter(teamServes / servers.length, rng, 0.2);
    s.serveErrors = jitter(s.servesTotal * 0.12, rng, 0.7);
  }
  distribute(servers, aces, ability, rng, (p, n) => {
    out.get(p)!.serveAces += n;
  });

  const receptions = rallies * 0.44;
  const digs = rallies * (0.335 - 0.04 * level);
  const touches = rallies * 0.09;
  for (const p of players) {
    const pos = posOf(p);
    const s = out.get(p)!;
    // Middles and the libero split the back row between them.
    s.ralliesPlayed = pos === Position.Libero || pos === Position.MiddleBlocker
      ? Math.round(rallies * 0.67)
      : rallies;

    s.receptionsTotal = jitter(receptions * RECEPTION_SHARE[pos], rng, 0.25);
    const passer = relative(p);
    s.receptionErrors = Math.min(s.receptionsTotal, jitter(s.receptionsTotal * receptionErrorShare / passer, rng, 0.8));
    s.receptionPerfect = Math.min(
      s.receptionsTotal - s.receptionErrors,
      jitter(s.receptionsTotal * perfectShare * passer, rng, 0.3),
    );
    s.receptionPositive = Math.min(
      s.receptionsTotal - s.receptionErrors - s.receptionPerfect,
      jitter(s.receptionsTotal * positiveShare, rng, 0.3),
    );
    s.receptionPoor = s.receptionsTotal - s.receptionErrors - s.receptionPerfect - s.receptionPositive;

    s.digsTotal = jitter(digs * DIG_SHARE[pos], rng, 0.35);
    if (pos !== Position.Libero) s.blockTouches = jitter(touches / 6, rng, 0.6);
    if (pos === Position.Setter) {
      // Every kill is assisted in the engine too.
      s.setAssists = kills;
      s.setsMade = Math.round(kills / killRate);
      s.setErrors = jitter(rallies * 0.015, rng, 0.8);
    }
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
  // The remainder goes to the last player who can take a share at all — a
  // zero-weight player (a libero, for kills) must never absorb the leftovers.
  let last = weights.length - 1;
  while (last > 0 && weights[last] <= 0) last--;
  let remaining = total;
  for (let i = 0; i <= last && remaining > 0; i++) {
    if (weights[i] <= 0) continue;
    const share = i === last
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
