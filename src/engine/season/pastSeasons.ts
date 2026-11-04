/**
 * Competitions' past seasons, read back from their matches: every fixture of
 * the save is kept, so a league's table of any season can be drawn up again —
 * as it stood at the end of the regular season, the playoffs never feeding
 * into it — and a cup's winner and final found. The season's record says who
 * took the title.
 */

import { awardLeaguePoints, compareTableRows, newTableRow, type LeagueTableRow } from '../model/club.ts';
import { DAYS_PER_SEASON, type Fixture, type World } from '../world/world.ts';
import { PLAYOFF_ROUND_BASE } from './schedule.ts';

/** A competition's played matches of finished seasons, by season. */
function pastFixtures(world: World, compId: number): Map<number, Fixture[]> {
  const out = new Map<number, Fixture[]>();
  for (const f of world.fixtures) {
    if (f === undefined || f.competitionId !== compId || !f.played) continue;
    const season = Math.floor(f.day / DAYS_PER_SEASON);
    if (season >= world.season) continue;
    const list = out.get(season);
    if (list !== undefined) list.push(f);
    else out.set(season, [f]);
  }
  return out;
}

/** "2031/32". */
export function seasonLabel(world: Pick<World, 'startYear'>, season: number): string {
  const y = world.startYear + season;
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
}

/** Who won a competition in a season, or -1 if the record doesn't say. */
export function championOf(world: World, compId: number, season: number): number {
  const record = world.history.find((r) => r.season === season);
  return record?.champions.find((c) => c.competitionId === compId)?.winner ?? -1;
}

/** The finished seasons a competition has matches in, the latest first. */
export function pastSeasonsOf(world: World, compId: number): number[] {
  return [...pastFixtures(world, compId).keys()].sort((a, b) => b - a);
}

/** A league's table of a past season, as the regular season left it. */
export function pastLeagueTable(world: World, compId: number, season: number): LeagueTableRow[] {
  const rows = new Map<number, LeagueTableRow>();
  const row = (clubId: number): LeagueTableRow => {
    let r = rows.get(clubId);
    if (r === undefined) {
      r = newTableRow(clubId);
      rows.set(clubId, r);
    }
    return r;
  };
  for (const f of pastFixtures(world, compId).get(season) ?? []) {
    if (f.round >= PLAYOFF_ROUND_BASE) continue;
    const h = row(f.home);
    const a = row(f.away);
    const [wp, lp] = awardLeaguePoints(Math.max(f.homeSets, f.awaySets), Math.min(f.homeSets, f.awaySets));
    h.played++;
    a.played++;
    h.setsFor += f.homeSets;
    h.setsAgainst += f.awaySets;
    a.setsFor += f.awaySets;
    a.setsAgainst += f.homeSets;
    for (const [hp, ap] of f.setScores) {
      h.pointsFor += hp;
      h.pointsAgainst += ap;
      a.pointsFor += ap;
      a.pointsAgainst += hp;
    }
    const homeWon = f.homeSets > f.awaySets;
    (homeWon ? h : a).won++;
    (homeWon ? a : h).lost++;
    (homeWon ? h : a).points += wp;
    (homeWon ? a : h).points += lp;
  }
  return [...rows.values()].sort(compareTableRows);
}

/** One past edition of a cup: who won it, and its last match — the final. */
export interface PastCupEdition {
  season: number;
  winner: number;
  final: Fixture | null;
  matches: Fixture[];
}

export function pastCupEditions(world: World, compId: number): PastCupEdition[] {
  return [...pastFixtures(world, compId).entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([season, list]) => {
      const matches = [...list].sort((a, b) => a.day - b.day || a.id - b.id);
      const final = matches[matches.length - 1] ?? null;
      const champion = championOf(world, compId, season);
      const fromFinal = final === null ? -1 : final.homeSets > final.awaySets ? final.home : final.away;
      return { season, winner: champion >= 0 ? champion : fromFinal, final, matches };
    });
}
