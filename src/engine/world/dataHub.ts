/**
 * The Data Hub: a league's sides measured against each other — how efficiently each attacks, how
 * often it kills, aces and stuffs a ball, how well it passes, what it scores and concedes a set — and
 * against the league's average; and the manager's own six rotations, their side-out, break-point and
 * expected points, against what his opponents managed in theirs.
 */

import type { RotationStats } from '../match/stats.ts';
import { seasonFromReports } from './analysis.ts';
import { competitionStats, efficiency, passing } from './competitionStats.ts';
import type { World } from './world.ts';

export type HubMetric =
  | 'attackEff' | 'killPct' | 'acesPerSet' | 'blocksPerSet' | 'digsPerSet' | 'passPct' | 'pointsPerSet' | 'concededPerSet' | 'winPct';

export const HUB_METRICS: Readonly<Record<HubMetric, { name: string; short: string; pct: boolean; higherIsBetter: boolean }>> = {
  attackEff: { name: 'Attack efficiency', short: 'Att eff', pct: true, higherIsBetter: true },
  killPct: { name: 'Kill rate', short: 'Kill %', pct: true, higherIsBetter: true },
  acesPerSet: { name: 'Aces a set', short: 'Aces/set', pct: false, higherIsBetter: true },
  blocksPerSet: { name: 'Blocks a set', short: 'Blk/set', pct: false, higherIsBetter: true },
  digsPerSet: { name: 'Digs a set', short: 'Digs/set', pct: false, higherIsBetter: true },
  passPct: { name: 'Good passes', short: 'Pass %', pct: true, higherIsBetter: true },
  pointsPerSet: { name: 'Points scored a set', short: 'Pts/set', pct: false, higherIsBetter: true },
  concededPerSet: { name: 'Points conceded a set', short: 'Conc/set', pct: false, higherIsBetter: false },
  winPct: { name: 'Matches won', short: 'Win %', pct: true, higherIsBetter: true },
};

export const HUB_METRIC_KEYS = Object.keys(HUB_METRICS) as HubMetric[];

export interface HubRow {
  clubId: number;
  matches: number;
  sets: number;
  values: Record<HubMetric, number>;
}

/** Every side in a competition this season, measured; and the league's average of each measure. */
export function leagueHub(world: World, compId: number, season = world.season): { rows: HubRow[]; average: Record<HubMetric, number> } {
  const { teams } = competitionStats(world, compId, season);
  const rows: HubRow[] = teams.filter((t) => t.matches > 0).map((t) => {
    const sets = Math.max(1, t.setsWon + t.setsLost);
    return {
      clubId: t.clubId,
      matches: t.matches,
      sets,
      values: {
        attackEff: efficiency(t),
        killPct: t.attacks > 0 ? t.kills / t.attacks : 0,
        acesPerSet: t.aces / sets,
        blocksPerSet: t.blocks / sets,
        digsPerSet: t.digs / sets,
        passPct: passing(t),
        pointsPerSet: t.pointsFor / sets,
        concededPerSet: t.pointsAgainst / sets,
        winPct: t.won / t.matches,
      },
    };
  });
  const average = Object.fromEntries(HUB_METRIC_KEYS.map((k) => [
    k, rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.values[k], 0) / rows.length,
  ])) as Record<HubMetric, number>;
  return { rows, average };
}

/** One rotation's numbers: how often it sides out, how often it breaks, and points won per ten rallies. */
export interface RotationLine {
  sideOut: number;
  breakPoint: number;
  /** Points won per ten rallies played in it. */
  expected: number;
  rallies: number;
}

function line(r: RotationStats): RotationLine {
  const rallies = r.serveRallies + r.receiveRallies;
  return {
    sideOut: r.receiveRallies > 0 ? r.sideOutsWon / r.receiveRallies : 0,
    breakPoint: r.serveRallies > 0 ? r.servePointsWon / r.serveRallies : 0,
    expected: rallies > 0 ? ((r.sideOutsWon + r.servePointsWon) / rallies) * 10 : 0,
    rallies,
  };
}

/** The manager's six rotations this season — and his opponents', all six together, to measure them by. */
export function rotationHub(world: World, clubId: number, season = world.season): { ours: RotationLine[]; theirs: RotationLine } | null {
  const reports = seasonFromReports(world, clubId, season);
  if (reports.matches.length === 0) return null;
  // The opponents' rotations, summed: what a side in this league manages against us.
  const theirs: RotationStats = { serveRallies: 0, servePointsWon: 0, receiveRallies: 0, sideOutsWon: 0 };
  for (const m of reports.matches) {
    const rep = world.matchReports?.get(m.fixture.id);
    if (rep === undefined) continue;
    const side = m.fixture.home === clubId ? 1 : 0;
    for (const r of rep.rotations[side]) {
      theirs.serveRallies += r[0];
      theirs.servePointsWon += r[1];
      theirs.receiveRallies += r[2];
      theirs.sideOutsWon += r[3];
    }
  }
  return { ours: reports.rotations.map(line), theirs: line(theirs) };
}
