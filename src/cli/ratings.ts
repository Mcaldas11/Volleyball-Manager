/**
 * Player-rating calibration.
 *
 * Plays a batch of league fixtures through both the full rally engine and the
 * background quick-sim, rates every player who took part, and reports the
 * spread per position. The point is that a 7.0 means the same thing whether
 * the user watched the match or not, and whether the player is a libero or
 * an opposite: every position should centre on the neutral mark with a
 * similar spread on both paths.
 */

import { simulateMatch } from '../engine/match/engine.ts';
import { matchRating, playedInMatch, ratingValue } from '../engine/match/playerRating.ts';
import type { PlayerMatchStats } from '../engine/match/stats.ts';
import { POSITIONS, POSITION_SHORT, type Position } from '../engine/model/positions.ts';
import { quickSimulate } from '../engine/season/quickSim.ts';
import { pickLineup, toTeamSetup } from '../engine/season/seasonEngine.ts';
import { stubManager, type World } from '../engine/world/world.ts';
import { generateWorld } from '../engine/world/worldGen.ts';

export interface RatingSample {
  ratings: number[];
  /** Value per set's worth of rallies, before the position baseline is applied. */
  perSet: number[];
}

export interface RatingReport {
  detailed: Map<Position, RatingSample>;
  quick: Map<Position, RatingSample>;
}

function emptySamples(): Map<Position, RatingSample> {
  return new Map(POSITIONS.map((p) => [p, { ratings: [], perSet: [] }]));
}

function record(
  world: World,
  into: Map<Position, RatingSample>,
  stats: Map<number, PlayerMatchStats>,
  setsFor: number,
  setsAgainst: number,
): void {
  for (const [p, s] of stats) {
    if (!playedInMatch(s) || s.ralliesPlayed < 30) continue;
    const pos = world.players.position[p] as Position;
    const sample = into.get(pos)!;
    sample.ratings.push(matchRating(s, pos, setsFor, setsAgainst));
    sample.perSet.push((ratingValue(s) / Math.max(1, s.ralliesPlayed)) * 45);
  }
}

export function runRatingReport(matches = 300, seed = 20260728): RatingReport {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const leagues = world.competitions.filter((c) => c.kind === 'league' && c.participants.length >= 2);
  const report: RatingReport = { detailed: emptySamples(), quick: emptySamples() };

  for (let m = 0; m < matches; m++) {
    const comp = leagues[m % leagues.length];
    const ids = comp.participants;
    const h = world.clubs[ids[world.rng.int(0, ids.length - 1)]];
    let a = world.clubs[ids[world.rng.int(0, ids.length - 1)]];
    if (a.id === h.id) a = world.clubs[ids[(ids.indexOf(h.id) + 1) % ids.length]];

    const full = simulateMatch(world.players, {
      home: toTeamSetup(world.players, h),
      away: toTeamSetup(world.players, a),
      format: 0,
      importance: 0.5,
      neutralVenue: false,
      collectLog: false,
      seed: world.rng.next(),
    });
    record(world, report.detailed, full.stats.home.players, full.homeSets, full.awaySets);
    record(world, report.detailed, full.stats.away.players, full.awaySets, full.homeSets);

    const quick = quickSimulate(world.players, pickLineup(world.players, h), pickLineup(world.players, a), 0, world.rng);
    record(world, report.quick, quick.homeStats, quick.homeSets, quick.awaySets);
    record(world, report.quick, quick.awayStats, quick.awaySets, quick.homeSets);
  }
  return report;
}

function summarise(xs: number[]): { mean: number; sd: number; p5: number; p95: number } {
  if (xs.length === 0) return { mean: 0, sd: 0, p5: 0, p95: 0 };
  const sorted = [...xs].sort((x, y) => x - y);
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
  return {
    mean,
    sd,
    p5: sorted[Math.floor(sorted.length * 0.05)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
  };
}

export function printRatingReport(report: RatingReport): void {
  for (const [label, samples] of [['Full engine', report.detailed], ['Quick sim', report.quick]] as const) {
    console.log(`\n  ${label}`);
    console.log('    Pos   n     value/set   rating  sd    p5    p95');
    for (const pos of POSITIONS) {
      const s = samples.get(pos)!;
      const v = summarise(s.perSet);
      const r = summarise(s.ratings);
      console.log(
        `    ${POSITION_SHORT[pos].padEnd(4)} ${String(s.ratings.length).padStart(5)}  ` +
        `${v.mean.toFixed(2).padStart(8)}    ${r.mean.toFixed(2)}   ${r.sd.toFixed(2)}  ` +
        `${r.p5.toFixed(1)}   ${r.p95.toFixed(1)}`,
      );
    }
  }
  console.log('');
}
