/**
 * A competition's statistics for a season: every side's record and box score,
 * and every player's, from what each match left behind.
 *
 * The sides' results come straight from the fixtures; their box scores are
 * the sum of their players' lines in the competition, each counted for the
 * club he plays for now — a man who changed clubs within it counts for his
 * new one.
 */

import { entrants } from './teamAwards.ts';
import type { World } from './world.ts';
import { DAYS_PER_SEASON } from './world.ts';

/** What a side or a player did in a competition: the box score. */
export interface BoxScore {
  kills: number;
  attacks: number;
  /** Attacks hit out or blocked. */
  attackErrors: number;
  aces: number;
  serves: number;
  blocks: number;
  digs: number;
  receptions: number;
  /** Perfect and positive passes. */
  goodPasses: number;
  assists: number;
}

export interface TeamCompStats extends BoxScore {
  clubId: number;
  matches: number;
  won: number;
  setsWon: number;
  setsLost: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface PlayerCompStats extends BoxScore {
  p: number;
  /** The club he plays for now, -1 if none. */
  clubId: number;
  apps: number;
  ratingSum: number;
  points: number;
  mvps: number;
}

function emptyBox(): BoxScore {
  return { kills: 0, attacks: 0, attackErrors: 0, aces: 0, serves: 0, blocks: 0, digs: 0, receptions: 0, goodPasses: 0, assists: 0 };
}

const BOX_KEYS = Object.keys(emptyBox()) as Array<keyof BoxScore>;

/** Kills less errors, over attacks. */
export function efficiency(b: BoxScore): number {
  return b.attacks > 0 ? (b.kills - b.attackErrors) / b.attacks : 0;
}

/** Good passes, over passes. */
export function passing(b: BoxScore): number {
  return b.receptions > 0 ? b.goodPasses / b.receptions : 0;
}

/** Every side's and every player's numbers in one competition's season — this one, or last. */
export function competitionStats(
  world: World, compId: number, season = world.season,
): { teams: TeamCompStats[]; players: PlayerCompStats[] } {
  const comp = world.competitions[compId];
  if (comp === undefined) return { teams: [], players: [] };
  const teams = new Map<number, TeamCompStats>();
  const side = (clubId: number): TeamCompStats => {
    let t = teams.get(clubId);
    if (t === undefined) {
      t = { clubId, matches: 0, won: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0, ...emptyBox() };
      teams.set(clubId, t);
    }
    return t;
  };
  if (season === world.season) for (const c of entrants(comp)) side(c);

  const from = season * DAYS_PER_SEASON;
  const to = from + DAYS_PER_SEASON;
  for (const id of comp.fixtureIds) {
    const f = world.fixtures[id];
    if (f === undefined || !f.played || f.day < from || f.day >= to) continue;
    for (const [clubId, mine] of [[f.home, 0], [f.away, 1]] as const) {
      const t = side(clubId);
      t.matches++;
      const won = mine === 0 ? f.homeSets : f.awaySets;
      const lost = mine === 0 ? f.awaySets : f.homeSets;
      t.setsWon += won;
      t.setsLost += lost;
      if (won > lost) t.won++;
      for (const s of f.setScores) {
        t.pointsFor += s[mine];
        t.pointsAgainst += s[1 - mine];
      }
    }
  }

  const store = world.players;
  const players: PlayerCompStats[] = [];
  for (const [p, lines] of world.competitionRecords) {
    const l = lines.find((x) => x.season === season && x.competitionId === compId);
    if (l === undefined || l.apps === 0) continue;
    const clubId = store.clubId[p];
    const line: PlayerCompStats = {
      p, clubId, apps: l.apps, ratingSum: l.ratingSum, points: l.points, mvps: l.mvps,
      kills: l.kills ?? 0, attacks: l.attacks ?? 0, attackErrors: l.attackErrors ?? 0, aces: l.aces,
      serves: l.serves ?? 0, blocks: l.blocks, digs: l.digs ?? 0, receptions: l.receptions ?? 0,
      goodPasses: l.goodPasses ?? 0, assists: l.assists ?? 0,
    };
    players.push(line);
    const t = teams.get(clubId);
    if (t !== undefined) for (const k of BOX_KEYS) t[k] += line[k];
  }
  return { teams: [...teams.values()], players };
}
