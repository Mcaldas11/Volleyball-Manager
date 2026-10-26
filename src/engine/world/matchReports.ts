/**
 * The manager's matches, kept for their report.
 *
 * A match played through the full engine leaves a box score and a rotation
 * table behind, but the rally log that goes with it is far too big to keep a
 * career's worth of. So for every match of the manager's own club the box
 * score — each player's line — and the rotations are packed into numbers and
 * kept with the save: any match already played, this season or any before,
 * can be opened and read again. The rally log is there only while it is
 * still in memory.
 */

import type { MatchResult, RallyLogEntry } from '../match/engine.ts';
import { newPlayerStats, newRotationStats, newTeamStats, type PlayerMatchStats, type TeamMatchStats } from '../match/stats.ts';
import type { Fixture, World } from './world.ts';

/** A player's line, in the order it is packed. */
const PLAYER_FIELDS = [
  'servesTotal', 'serveAces', 'serveErrors',
  'receptionsTotal', 'receptionPerfect', 'receptionPositive', 'receptionPoor', 'receptionErrors',
  'attacksTotal', 'attackKills', 'attackErrors', 'attackBlocked',
  'blockPoints', 'blockTouches', 'blockErrors',
  'digsTotal', 'digErrors',
  'setsMade', 'setAssists', 'setErrors',
  'ralliesPlayed', 'plusMinus',
] as const satisfies ReadonlyArray<Exclude<keyof PlayerMatchStats, 'playerIdx'>>;

/** A rotation's line, in the order it is packed. */
const ROTATION_FIELDS = ['serveRallies', 'servePointsWon', 'receiveRallies', 'sideOutsWon'] as const;

/** One match's box score, packed. */
export interface MatchReport {
  /** Everyone who got on court: [player, side (0 home, 1 away), ...his line]. */
  lines: number[][];
  /** Each side's six rotations. */
  rotations: [number[][], number[][]];
  opponentErrors: [number, number];
  longestRun: [number, number];
  totalRallies: number;
  /**
   * Each set's rallies in order, a letter a rally: who won it — lower case the
   * home side, upper case the away side — and how: k a kill, a an ace, b a
   * block, e an error by the other side. Kept from the rally log, when there was one.
   */
  flow?: string[];
}

/** How a point was won, as `MatchReport.flow` writes it. */
export type PointHow = 'k' | 'a' | 'b' | 'e';

/** A match's rallies, set by set, as `MatchReport.flow` keeps them. */
export function rallyFlow(log: readonly RallyLogEntry[]): string[] {
  const sets: string[] = [];
  for (const r of log) {
    const last = r.contacts[r.contacts.length - 1];
    // A call turned over on video ends with the other side's contact: count it as their error.
    let how: PointHow = 'e';
    if (last !== undefined) {
      if ((last.kind === 'kill' || last.kind === 'ace') && last.team === r.winner) how = last.kind === 'kill' ? 'k' : 'a';
      else if (last.kind === 'blocked' && last.team !== r.winner) how = 'b';
    }
    sets[r.set] = (sets[r.set] ?? '') + (r.winner === 0 ? how : how.toUpperCase());
  }
  return Array.from(sets, (s) => s ?? '');
}

/** Keep a finished match's box score, if it was one of the manager's club's. */
export function keepMatchReport(world: World, fixture: Fixture, result: MatchResult): void {
  const club = world.userClubId;
  if (club < 0 || (fixture.home !== club && fixture.away !== club)) return;
  if (world.competitions[fixture.competitionId]?.kind === 'international') return;
  const lines: number[][] = [];
  const pack = (team: TeamMatchStats, side: 0 | 1): void => {
    for (const [p, s] of team.players) {
      if (s.ralliesPlayed <= 0 && s.attacksTotal + s.servesTotal + s.receptionsTotal === 0) continue;
      lines.push([p, side, ...PLAYER_FIELDS.map((k) => s[k])]);
    }
  };
  pack(result.stats.home, 0);
  pack(result.stats.away, 1);
  const rotations = (team: TeamMatchStats): number[][] => team.rotations.map((r) => ROTATION_FIELDS.map((k) => r[k]));
  (world.matchReports ??= new Map()).set(fixture.id, {
    lines,
    rotations: [rotations(result.stats.home), rotations(result.stats.away)],
    opponentErrors: [result.stats.home.opponentErrors, result.stats.away.opponentErrors],
    longestRun: [result.stats.home.longestRun, result.stats.away.longestRun],
    totalRallies: result.totalRallies,
    ...(result.log !== null ? { flow: rallyFlow(result.log) } : {}),
  });
}

/** A kept match as the report screens read it: the box score and the rotations, no rally log. */
export function reportResult(fixture: Fixture, report: MatchReport): MatchResult {
  const team = (side: 0 | 1): TeamMatchStats => {
    const t = newTeamStats();
    for (const line of report.lines) {
      if (line[1] !== side) continue;
      const s = newPlayerStats(line[0]);
      PLAYER_FIELDS.forEach((k, i) => { s[k] = line[2 + i] ?? 0; });
      t.players.set(line[0], s);
    }
    t.rotations = report.rotations[side].map((r) => {
      const rot = newRotationStats();
      ROTATION_FIELDS.forEach((k, i) => { rot[k] = r[i] ?? 0; });
      return rot;
    });
    t.setsWon = side === 0 ? fixture.homeSets : fixture.awaySets;
    t.pointsByset = fixture.setScores.map((s) => s[side]);
    t.opponentErrors = report.opponentErrors[side];
    t.longestRun = report.longestRun[side];
    return t;
  };
  return {
    homeSets: fixture.homeSets,
    awaySets: fixture.awaySets,
    setScores: fixture.setScores,
    stats: { home: team(0), away: team(1) },
    log: null,
    totalRallies: report.totalRallies,
    mvp: fixture.mvp,
  };
}

/** The bare result of a match nothing more was kept of: the score and the sets. */
export function bareResult(fixture: Fixture): MatchResult {
  const team = (side: 0 | 1): TeamMatchStats => {
    const t = newTeamStats();
    t.setsWon = side === 0 ? fixture.homeSets : fixture.awaySets;
    t.pointsByset = fixture.setScores.map((s) => s[side]);
    return t;
  };
  return {
    homeSets: fixture.homeSets,
    awaySets: fixture.awaySets,
    setScores: fixture.setScores,
    stats: { home: team(0), away: team(1) },
    log: null,
    totalRallies: fixture.setScores.reduce((sum, [h, a]) => sum + h + a, 0),
    mvp: fixture.mvp,
  };
}
