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
import { Position } from '../model/positions.ts';
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
      // Shanked off the pass: the server's ace.
      else if (last.kind === 'receptionError' && last.team !== r.winner) how = 'a';
      else if (last.kind === 'blocked' && last.team !== r.winner) how = 'b';
      // An attack called out, turned over on video as in or off the block: the hitter's kill.
      else if (r.overturned === true && last.kind === 'attackError' && last.team === r.winner && r.doubt !== 'netTouch') how = 'k';
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

/** What a player has done for a club, summed over every one of its matches kept here. */
export interface ClubRecord {
  /** Matches he got on court in, and the sets those went to. */
  games: number;
  sets: number;
  points: number;
  kills: number;
  attacks: number;
  attackErrors: number;
  aces: number;
  blocks: number;
  digs: number;
  passes: number;
  goodPasses: number;
  perfectPasses: number;
  passErrors: number;
  assists: number;
  /** Balls set, and those that went astray. */
  setsMade: number;
  setErrors: number;
}

/**
 * A player's numbers for a club, from the box scores kept of its matches — the
 * manager's club's, since he took it over. Null if none of them had him on court.
 */
export function clubRecordOf(world: World, p: number, clubId: number): ClubRecord | null {
  const reports = world.matchReports;
  if (reports === undefined || reports.size === 0) return null;
  const byId = new Map<number, Fixture>();
  for (const f of world.fixtures) if (reports.has(f.id)) byId.set(f.id, f);
  const r: ClubRecord = {
    games: 0, sets: 0, points: 0, kills: 0, attacks: 0, attackErrors: 0, aces: 0, blocks: 0, digs: 0, passes: 0, goodPasses: 0, perfectPasses: 0, passErrors: 0, assists: 0, setsMade: 0, setErrors: 0,
  };
  const at = (k: (typeof PLAYER_FIELDS)[number]): number => 2 + PLAYER_FIELDS.indexOf(k);
  for (const [id, report] of reports) {
    const f = byId.get(id);
    if (f === undefined) continue;
    const side = f.home === clubId ? 0 : f.away === clubId ? 1 : -1;
    if (side < 0) continue;
    const line = report.lines.find((l) => l[0] === p && l[1] === side);
    if (line === undefined || (line[at('ralliesPlayed')] ?? 0) <= 0) continue;
    const v = (k: (typeof PLAYER_FIELDS)[number]): number => line[at(k)] ?? 0;
    r.games++;
    r.sets += f.homeSets + f.awaySets;
    r.kills += v('attackKills');
    r.attacks += v('attacksTotal');
    r.attackErrors += v('attackErrors') + v('attackBlocked');
    r.aces += v('serveAces');
    r.blocks += v('blockPoints');
    r.digs += v('digsTotal');
    r.passes += v('receptionsTotal');
    r.goodPasses += v('receptionPerfect') + v('receptionPositive');
    r.perfectPasses += v('receptionPerfect');
    r.passErrors += v('receptionErrors');
    r.assists += v('setAssists');
    r.setsMade += v('setsMade');
    r.setErrors += v('setErrors');
  }
  r.points = r.kills + r.aces + r.blocks;
  return r.games > 0 ? r : null;
}

const one = (v: number): string => v.toFixed(1);
const pct = (a: number, b: number): string => `${Math.round((a / Math.max(1, b)) * 100)}%`;

/** A club record drawn up for the job: big numbers in rows, then the lines beneath. */
export interface ClubRecordSheet {
  figures: Array<Array<[label: string, value: string | number]>>;
  rows: Array<[label: string, text: string]>;
}

/**
 * A player's club record as it should be read for his position: what a libero
 * did is digs and passes, what a setter did is assists — points say next to
 * nothing about either.
 */
export function clubRecordSheet(position: Position, r: ClubRecord): ClubRecordSheet {
  const sets = Math.max(1, r.sets);
  const attack: [string, string] = ['Attack', `${pct(r.kills, r.attacks)} kills · ${one(r.kills / sets)} a set · efficiency ${pct(r.kills - r.attackErrors, r.attacks)}`];
  const serve: [string, string] = ['Serve', `${one(r.aces / sets)} aces a set`];
  const block: [string, string] = ['Block', `${one(r.blocks / sets)} a set`];
  const digs: [string, string] = ['Digs', `${r.digs} · ${one(r.digs / sets)} a set`];
  const reception: [string, string] = ['Reception', `${pct(r.goodPasses, r.passes)} good · ${r.passes} passes`];
  const when = (on: boolean, row: [string, string]): Array<[string, string]> => (on ? [row] : []);
  switch (position) {
    case Position.Libero:
      return {
        figures: [
          [['Digs', r.digs], ['Digs a set', one(r.digs / sets)], ['Digs a game', one(r.digs / r.games)]],
          [['Passes', r.passes], ['Good passes', pct(r.goodPasses, r.passes)], ['Perfect passes', pct(r.perfectPasses, r.passes)]],
        ],
        rows: when(r.passes > 0, ['Reception', `${one(r.passes / sets)} passes a set · ${r.passErrors} errors (${pct(r.passErrors, r.passes)})`]),
      };
    case Position.Setter:
      return {
        figures: [
          [['Assists', r.assists], ['Assists a set', one(r.assists / sets)], ['Assists a game', one(r.assists / r.games)]],
          [['Balls set', r.setsMade], ['Set into kills', pct(r.assists, r.setsMade)], ['Setting errors', r.setErrors]],
        ],
        rows: [serve, block, ...when(r.digs > 0, digs), ['Points', `${r.points} · ${one(r.points / sets)} a set`]],
      };
    case Position.MiddleBlocker:
      return {
        figures: [
          [['Blocks', r.blocks], ['Blocks a set', one(r.blocks / sets)], ['Points a set', one(r.points / sets)]],
          [['Points', r.points], ['Kills', r.kills], ['Aces', r.aces]],
        ],
        rows: [...when(r.attacks > 0, attack), serve],
      };
    case Position.OutsideHitter:
      return {
        figures: [
          [['Points', r.points], ['Points a set', one(r.points / sets)], ['Kills', r.kills]],
          [['Good passes', pct(r.goodPasses, r.passes)], ['Digs a set', one(r.digs / sets)], ['Aces', r.aces]],
        ],
        rows: [...when(r.attacks > 0, attack), ...when(r.passes > 0, reception), ...when(r.digs > 0, digs), serve, block],
      };
    default:
      return {
        figures: [
          [['Points', r.points], ['Points a game', one(r.points / r.games)], ['Points a set', one(r.points / sets)]],
          [['Kills', r.kills], ['Aces', r.aces], ['Blocks', r.blocks]],
        ],
        rows: [...when(r.attacks > 0, attack), serve, block, ...when(r.digs > 0, digs)],
      };
  }
}

/** The same record in a phrase, for the words said about him. */
export function clubRecordHeadline(position: Position, r: ClubRecord): string {
  const sets = Math.max(1, r.sets);
  switch (position) {
    case Position.Libero: return `${r.digs} digs and ${pct(r.goodPasses, r.passes)} of his passes good`;
    case Position.Setter: return `${r.assists} assists, ${one(r.assists / sets)} a set`;
    case Position.MiddleBlocker: return `${r.blocks} blocks and ${r.kills} kills`;
    case Position.OutsideHitter: return `${r.points} points and ${pct(r.goodPasses, r.passes)} of his passes good`;
    default: return `${r.points} points, ${one(r.points / sets)} a set`;
  }
}
