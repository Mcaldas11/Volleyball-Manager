/**
 * The coaches, ranked and remembered. The world ranking puts every head coach in work — and the
 * manager — in order of their name in the game, with what they have won. The legends are the coaches
 * who won most at a club, or for a country's clubs: each coach's titles from every spell, the manager's
 * from every job.
 */

import { StaffRole } from '../model/staff.ts';
import { coachSpells, spellTrophies } from './career.ts';
import type { World } from './world.ts';

/** One coach: a staff member's id, or -1 for the manager. */
export interface CoachEntry {
  staffId: number;
  name: string;
  nation: number;
  /** His club now, -1 if none. */
  clubId: number;
  reputation: number;
  /** Titles won in charge, each with the club. */
  titles: Array<{ competitionId: number; year: number; clubId: number }>;
  won: number;
  lost: number;
}

/** Every coach on record — the head coaches past and present, and the manager. */
export function allCoaches(world: World): CoachEntry[] {
  const out: CoachEntry[] = [];
  for (const s of world.staff) {
    if (s.role !== StaffRole.HeadCoach && (s.spells?.length ?? 0) === 0) continue;
    const spells = coachSpells(world, s);
    if (spells.length === 0) continue;
    out.push({
      staffId: s.id, name: `${s.firstName} ${s.lastName}`, nation: s.nation,
      clubId: s.role === StaffRole.HeadCoach && s.retired !== true ? s.clubId : -1, reputation: s.reputation,
      titles: spells.flatMap((sp) => spellTrophies(world, sp).map((t) => ({ ...t, clubId: sp.clubId }))),
      won: spells.reduce((n, sp) => n + sp.won, 0), lost: spells.reduce((n, sp) => n + sp.lost, 0),
    });
  }
  const m = world.manager;
  const career = world.career;
  out.push({
    staffId: -1, name: `${m.firstName} ${m.lastName}`, nation: m.nation, clubId: world.userClubId, reputation: career.reputation,
    titles: career.jobs.flatMap((j) => j.trophies.map((t) => ({ competitionId: t.competitionId, year: world.startYear + t.season + 1, clubId: j.clubId }))),
    won: career.jobs.reduce((n, j) => n + j.won, 0), lost: career.jobs.reduce((n, j) => n + j.lost, 0),
  });
  return out;
}

/** The world ranking: the coaches in work — and the manager — by reputation. */
export function coachRanking(world: World): CoachEntry[] {
  return allCoaches(world)
    .filter((c) => c.clubId >= 0 || c.staffId === -1)
    .sort((a, b) => b.reputation - a.reputation || b.titles.length - a.titles.length);
}

/** A club's legends — or a country's, `nation` set — the coaches who won most there. */
export function coachLegends(world: World, by: { clubId?: number; nation?: number }): Array<CoachEntry & { here: number }> {
  return allCoaches(world)
    .map((c) => {
      const here = c.titles.filter((t) => by.clubId !== undefined
        ? t.clubId === by.clubId
        : world.clubs[t.clubId]?.nation === by.nation).length;
      return { ...c, here };
    })
    .filter((c) => c.here > 0)
    .sort((a, b) => b.here - a.here || b.reputation - a.reputation);
}
