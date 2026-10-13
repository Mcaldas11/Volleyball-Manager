/**
 * The analyst's data: a season of the manager's club, from every match it
 * played through the full engine.
 *
 * Where the attacks came down — ours, and the opposition's against us — on a
 * six by six grid of the court seen from the hitter: his own sideline (the
 * line) on the left, the far one (the cross) on the right, the net at the top
 * and the end line at the bottom; with the balls hit long, wide or off the
 * block counted apart. How each of our attackers does from each lane. And,
 * from the box scores the save keeps, the side-out and break-point rates of
 * each rotation, and how the side's attack and side-out ran match by match.
 */

import type { MatchResult } from '../match/engine.ts';
import { aggregateTeam, newRotationStats, type RotationStats } from '../match/stats.ts';
import { reportResult } from './matchReports.ts';
import { DAYS_PER_SEASON, type Fixture, type World } from './world.ts';

/** Cells across and deep. */
export const GRID = 6;

/** One side's attacks over a season, by where they came down. */
export interface AttackMap {
  /** Attacks into each cell, row by row from the net: `deep * GRID + across`. */
  attacks: number[];
  kills: number[];
  /** Hit beyond the end line, beyond a sideline, or off the block and out for a point. */
  long: number;
  wide: number;
  blockout: number;
}

/** A season of the manager's club, gathered match by match. */
export interface SeasonAnalysis {
  season: number;
  clubId: number;
  matches: number;
  ours: AttackMap;
  theirs: AttackMap;
  /** Each of our attackers in each lane: "player|lane" → [attempts, kills, errors and blocks]. */
  lanes: Record<string, [number, number, number]>;
}

function emptyMap(): AttackMap {
  return { attacks: new Array(GRID * GRID).fill(0), kills: new Array(GRID * GRID).fill(0), long: 0, wide: 0, blockout: 0 };
}

/** Seasons kept: this one and the two before it. */
const KEEP_SEASONS = 3;

/** The season's analysis for a club — made the first time it is asked for. */
export function analysisFor(world: World, clubId: number, season: number): SeasonAnalysis | undefined {
  return (world.analysis ?? []).find((a) => a.clubId === clubId && a.season === season);
}

/** Note a match of the manager's club, played in full, into the season's analysis. */
export function noteAnalysis(world: World, fixture: Fixture, result: MatchResult): void {
  const club = world.userClubId;
  if (club < 0 || (fixture.home !== club && fixture.away !== club) || result.log === null) return;
  if (world.competitions[fixture.competitionId]?.kind === 'friendly') return;
  const all = (world.analysis ??= []);
  let a = analysisFor(world, club, world.season);
  if (a === undefined) {
    a = { season: world.season, clubId: club, matches: 0, ours: emptyMap(), theirs: emptyMap(), lanes: {} };
    all.push(a);
    // Old seasons go.
    world.analysis = all.filter((x) => x.season > world.season - KEEP_SEASONS);
  }
  a.matches++;
  const us: 0 | 1 = fixture.home === club ? 0 : 1;
  for (const rally of result.log) {
    for (const c of rally.contacts) {
      if (c.kind !== 'attack' && c.kind !== 'kill' && c.kind !== 'attackError' && c.kind !== 'blocked') continue;
      const map = c.team === us ? a.ours : a.theirs;
      if (c.team === us && c.detail !== undefined) {
        const key = `${c.player}|${c.detail}`;
        const line = (a.lanes[key] ??= [0, 0, 0]);
        line[0]++;
        if (c.kind === 'kill') line[1]++;
        if (c.kind === 'attackError' || c.kind === 'blocked') line[2]++;
      }
      const l = c.land;
      if (c.kind === 'blocked' || l === undefined) continue;
      if (c.shot === 'blockout' && c.kind === 'kill') {
        map.blockout++;
        continue;
      }
      if (l.deep > 1) { map.long++; continue; }
      if (l.across < 0 || l.across > 1) { map.wide++; continue; }
      const cell = Math.min(GRID - 1, Math.floor(l.deep * GRID)) * GRID + Math.min(GRID - 1, Math.floor(l.across * GRID));
      map.attacks[cell]++;
      if (c.kind === 'kill') map.kills[cell]++;
    }
  }
}

// ---- From the kept box scores ------------------------------------------------------------

/** A match of the season, as the side's numbers tell it. */
export interface MatchLine {
  fixture: Fixture;
  opponent: number;
  won: boolean;
  /** Kills over attacks; side-outs over rallies received; points won serving over rallies served. */
  killRate: number;
  sideOut: number;
  breakPoint: number;
}

/** The season so far for a club's matches the save kept a box score of: each match, and each rotation. */
export function seasonFromReports(world: World, clubId: number, season: number): {
  matches: MatchLine[];
  rotations: RotationStats[];
  totals: { attacks: number; kills: number; errors: number; aces: number; serveErrors: number; blocks: number; sets: number };
} {
  const rotations = Array.from({ length: 6 }, newRotationStats);
  const totals = { attacks: 0, kills: 0, errors: 0, aces: 0, serveErrors: 0, blocks: 0, sets: 0 };
  const matches: MatchLine[] = [];
  const fixtures = world.fixtures
    .filter((f) => f.played && (f.home === clubId || f.away === clubId) && Math.floor(f.day / DAYS_PER_SEASON) === season &&
      world.competitions[f.competitionId]?.kind !== 'friendly')
    .sort((x, y) => x.day - y.day);
  for (const f of fixtures) {
    const kept = world.matchReports?.get(f.id);
    if (kept === undefined) continue;
    const result = reportResult(f, kept);
    const side = f.home === clubId ? result.stats.home : result.stats.away;
    const line = aggregateTeam(side);
    let received = 0;
    let sidedOut = 0;
    let served = 0;
    let broke = 0;
    side.rotations.forEach((r, i) => {
      rotations[i].receiveRallies += r.receiveRallies;
      rotations[i].sideOutsWon += r.sideOutsWon;
      rotations[i].serveRallies += r.serveRallies;
      rotations[i].servePointsWon += r.servePointsWon;
      received += r.receiveRallies;
      sidedOut += r.sideOutsWon;
      served += r.serveRallies;
      broke += r.servePointsWon;
    });
    totals.attacks += line.attacksTotal;
    totals.kills += line.attackKills;
    totals.errors += line.attackErrors + line.attackBlocked;
    totals.aces += line.serveAces;
    totals.serveErrors += line.serveErrors;
    totals.blocks += line.blockPoints;
    totals.sets += f.setScores.length;
    const ours = f.home === clubId ? f.homeSets : f.awaySets;
    const theirs = f.home === clubId ? f.awaySets : f.homeSets;
    matches.push({
      fixture: f,
      opponent: f.home === clubId ? f.away : f.home,
      won: ours > theirs,
      killRate: line.attacksTotal > 0 ? line.attackKills / line.attacksTotal : 0,
      sideOut: received > 0 ? sidedOut / received : 0,
      breakPoint: served > 0 ? broke / served : 0,
    });
  }
  return { matches, rotations, totals };
}
