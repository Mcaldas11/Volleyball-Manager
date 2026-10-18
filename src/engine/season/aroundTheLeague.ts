/**
 * Around the league: the day's other matches in the manager's competition,
 * played alongside his own.
 *
 * At his kick-off the rest of the round is played out — they would be later
 * that day anyway, and the results are the same either way — and the live
 * screen then lets them unfold in step with his match: set for set, a score
 * that climbs as his does, final when theirs is over. And the table as it
 * would stand if every match ended now.
 */

import { compareTableRows, type LeagueTableRow } from '../model/club.ts';
import type { Fixture, World } from '../world/world.ts';
import { playFixture, type SeasonContext } from './seasonEngine.ts';

export interface AroundTheLeague {
  /** The day's other fixtures in the competition, played already. */
  ids: number[];
  /** The table as it stood before the round. */
  base: LeagueTableRow[];
}

/** Play the rest of today's round in the manager's competition, now — keeping the table as it stood. */
export function playAroundTheLeague(world: World, ctx: SeasonContext, own: Fixture): AroundTheLeague | null {
  const comp = world.competitions[own.competitionId];
  if (comp === undefined || comp.kind === 'friendly' || comp.kind === 'international') return null;
  const base = comp.table.map((r) => ({ ...r }));
  const ids: number[] = [];
  for (const id of world.fixturesByDay.get(own.day) ?? []) {
    const f = world.fixtures[id];
    if (f === undefined || f.id === own.id || f.competitionId !== own.competitionId) continue;
    if (!f.played) playFixture(world, ctx, f, false);
    if (f.played) ids.push(f.id);
  }
  return ids.length > 0 ? { ids, base } : null;
}

/** How far into his match the manager is: the sets done, and the score in the one under way. */
export interface Progress {
  sets: number;
  score: [number, number];
  over: boolean;
}

/** Another match as it stands at the same point of the evening: its sets so far, the one under way, done or not. */
export function asItStands(f: Fixture, at: Progress): { sets: Array<[number, number]>; live: [number, number] | null; done: boolean } {
  const all = f.setScores;
  if (at.over || at.sets >= all.length) return { sets: all, live: null, done: true };
  const target = at.sets === 4 ? 15 : 25;
  const t = Math.min(0.98, Math.max(at.score[0], at.score[1]) / target);
  const [h, a] = all[at.sets];
  return { sets: all.slice(0, at.sets), live: [Math.floor(h * t), Math.floor(a * t)], done: false };
}

/** What a match is worth in the table if it ended with these sets — a set lead counted as the win it would be. */
export function pointsFor(homeSets: number, awaySets: number): [number, number] {
  if (homeSets === awaySets) return [0, 0];
  const winner = homeSets > awaySets ? 0 : 1;
  const loser = Math.min(homeSets, awaySets);
  const pts: [number, number] = loser >= 2 ? [2, 1] : [3, 0];
  return winner === 0 ? pts : [pts[1], pts[0]];
}

/** The table if every match of the round ended now: rows in order, each with where it stood before. */
export function liveTable(
  base: readonly LeagueTableRow[], matches: ReadonlyArray<{ home: number; away: number; homeSets: number; awaySets: number }>,
): Array<LeagueTableRow & { was: number }> {
  const before = [...base].sort(compareTableRows).map((r) => r.clubId);
  const rows = base.map((r) => ({ ...r, was: before.indexOf(r.clubId) + 1 }));
  for (const m of matches) {
    const [ph, pa] = pointsFor(m.homeSets, m.awaySets);
    for (const [id, pts, sf, sa] of [[m.home, ph, m.homeSets, m.awaySets], [m.away, pa, m.awaySets, m.homeSets]] as const) {
      const row = rows.find((r) => r.clubId === id);
      if (row === undefined) continue;
      row.points += pts;
      row.setsFor += sf;
      row.setsAgainst += sa;
      if (sf === sa) continue;
      row.played += 1;
      if (sf > sa) row.won += 1;
      else row.lost += 1;
    }
  }
  return rows.sort(compareTableRows);
}
