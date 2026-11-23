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

/** What a title is worth to a coach's standing: the world's club title most, a domestic league well, a minor cup least. */
function titleWeight(world: World, competitionId: number): number {
  const c = world.competitions[competitionId];
  if (c === undefined) return 1;
  const rep = Math.max(0.3, c.reputation / 10000);
  switch (c.kind) {
    case 'clubworld': return 9;
    case 'continental': return 4 + 3 * rep;
    case 'league': return (c.tier === 1 ? 3 : 1) * (0.6 + rep);
    case 'cup': return 1.5 * (0.6 + rep);
    case 'supercup': return 0.6;
    default: return 0.4;
  }
}

/**
 * A coach's standing for the world ranking, not his name alone: what he has
 * won (weighted by what it was), how much and how often he wins, the level he
 * coaches at now, and his reputation. A short run of wins counts for little;
 * a record needs matches behind it before its rate weighs fully.
 */
export function coachScore(world: World, c: CoachEntry): number {
  const titles = c.titles.reduce((s, t) => s + titleWeight(world, t.competitionId), 0);
  const games = c.won + c.lost;
  // The win rate, pulled towards 50% until there are a hundred matches behind it.
  const rate = (c.won + 50) / (games + 100);
  const club = world.clubs[c.clubId];
  const league = club !== undefined ? world.competitions[club.leagueId] : undefined;
  const level = club === undefined ? 0.5
    : (league !== undefined ? Math.max(0.2, league.reputation / 10000) : 0.5) * (club.tier === 1 ? 1 : club.tier === 2 ? 0.6 : 0.35);
  // Titles with no record behind them (from before the save) count, but less than ones won on the record.
  const proven = Math.min(1, 0.45 + games / 120);
  return (
    c.reputation / 10000 * 25 +
    Math.min(70, titles * 3 * proven) +
    (rate - 0.5) * 80 +
    Math.min(25, Math.sqrt(c.won) * 1.2) +
    level * 20
  );
}

/** The world ranking: the coaches in work — and the manager — by their standing (see coachScore). */
export function coachRanking(world: World): CoachEntry[] {
  const scored = allCoaches(world)
    .filter((c) => c.clubId >= 0 || c.staffId === -1)
    .map((c) => ({ c, score: coachScore(world, c) }));
  return scored.sort((a, b) => b.score - a.score || b.c.titles.length - a.c.titles.length).map((x) => x.c);
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
