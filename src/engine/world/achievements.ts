/**
 * The manager's achievements: milestones of a career, unlocked the day they
 * are reached and kept with the date — wins piling up, the trophies of every
 * kind, the medals of a national team, the jobs and countries, a name the
 * whole sport knows.
 */

import { postMessage } from './inbox.ts';
import { coachAccolades } from './accolades.ts';
import type { World } from './world.ts';

export type AchievementGroup = 'Results' | 'Silverware' | 'Career';

export interface Achievement {
  id: string;
  group: AchievementGroup;
  title: string;
  /** What it takes. */
  hint: string;
  reached: (world: World) => boolean;
}

const wins = (world: World): number => world.career.jobs.reduce((s, j) => s + j.won, 0);
const trophies = (world: World): Array<{ competitionId: number; season: number }> => world.career.jobs.flatMap((j) => j.trophies);
const wonKind = (world: World, kinds: readonly string[]): boolean =>
  trophies(world).some((t) => kinds.includes(world.competitions[t.competitionId]?.kind ?? ''));
const daysInJob = (world: World, j: World['career']['jobs'][number]): number => (j.endDay < 0 ? world.day : j.endDay) - j.startDay;
/** A medal with a national team — of a kind of tournament, if given — at least this good (0 gold). */
const medal = (world: World, kind?: string, place = 2): boolean =>
  (world.career.nationalMedals ?? []).some((m) => m.place <= place && (kind === undefined || m.kind === kind));

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'firstWin', group: 'Results', title: 'Off the mark', hint: 'Win a match.', reached: (w) => wins(w) >= 1 },
  { id: 'wins100', group: 'Results', title: 'Century', hint: 'Win 100 matches.', reached: (w) => wins(w) >= 100 },
  { id: 'wins250', group: 'Results', title: 'Winning habit', hint: 'Win 250 matches.', reached: (w) => wins(w) >= 250 },
  { id: 'wins500', group: 'Results', title: 'Five hundred', hint: 'Win 500 matches.', reached: (w) => wins(w) >= 500 },
  { id: 'wins1000', group: 'Results', title: 'A thousand', hint: 'Win 1,000 matches.', reached: (w) => wins(w) >= 1000 },
  { id: 'promotion', group: 'Results', title: 'Going up', hint: 'Win promotion.', reached: (w) => w.career.promoted === true },
  { id: 'firstTrophy', group: 'Silverware', title: 'Silverware', hint: 'Win a trophy.', reached: (w) => trophies(w).length >= 1 },
  { id: 'league', group: 'Silverware', title: 'Champions', hint: 'Win a league title.', reached: (w) => wonKind(w, ['league']) },
  { id: 'cup', group: 'Silverware', title: 'Cup run', hint: 'Win a national cup.', reached: (w) => wonKind(w, ['cup']) },
  { id: 'supercup', group: 'Silverware', title: 'Super', hint: 'Win a super cup.', reached: (w) => wonKind(w, ['supercup']) },
  { id: 'continental', group: 'Silverware', title: 'Kings of the continent', hint: 'Win a continental club competition.', reached: (w) => wonKind(w, ['continental']) },
  { id: 'clubworld', group: 'Silverware', title: 'Best in the world', hint: 'Win the World Club Cup.', reached: (w) => wonKind(w, ['clubworld']) },
  {
    id: 'treble', group: 'Silverware', title: 'Treble', hint: 'Win three trophies in one season.',
    reached: (w) => {
      const by = new Map<number, number>();
      for (const t of trophies(w)) by.set(t.season, (by.get(t.season) ?? 0) + 1);
      return [...by.values()].some((n) => n >= 3);
    },
  },
  { id: 'collector', group: 'Silverware', title: 'Collector', hint: 'Win ten trophies.', reached: (w) => trophies(w).length >= 10 },
  { id: 'trophyRoom', group: 'Silverware', title: 'Trophy room', hint: 'Win 25 trophies.', reached: (w) => trophies(w).length >= 25 },
  { id: 'intlMedal', group: 'Silverware', title: 'On the podium', hint: 'Win a medal with a national team.', reached: (w) => medal(w) },
  { id: 'intlContinental', group: 'Silverware', title: 'Continental champions', hint: 'Win a continental championship with a national team.', reached: (w) => medal(w, 'continental', 0) },
  { id: 'nationsCup', group: 'Silverware', title: 'Nations Cup', hint: 'Win the Nations Cup.', reached: (w) => medal(w, 'nationsLeague', 0) },
  { id: 'intlWorlds', group: 'Silverware', title: 'World champions', hint: 'Win the World Championship.', reached: (w) => medal(w, 'worlds', 0) },
  { id: 'summerGold', group: 'Silverware', title: 'Summer gold', hint: 'Win gold at the Summer Games.', reached: (w) => medal(w, 'olympics', 0) },
  { id: 'coachOfYear', group: 'Career', title: 'Coach of the Year', hint: 'Be named a Coach of the Year.', reached: (w) => coachAccolades(w, -1).length > 0 },
  { id: 'national', group: 'Career', title: 'National duty', hint: 'Coach a national team.', reached: (w) => (w.career.nationalJobs?.length ?? 0) > 0 },
  {
    id: 'clubAndCountry', group: 'Career', title: 'Club and country', hint: 'Coach a club and a national team at the same time.',
    reached: (w) => w.career.nationalTeam !== undefined && w.career.nationalTeam >= 0 && w.career.jobs.some((j) => j.endDay < 0),
  },
  { id: 'loyal', group: 'Career', title: 'One-club man', hint: 'Five seasons in one job.', reached: (w) => w.career.jobs.some((j) => daysInJob(w, j) >= 5 * 365) },
  { id: 'furniture', group: 'Career', title: 'Part of the furniture', hint: 'Ten seasons in one job.', reached: (w) => w.career.jobs.some((j) => daysInJob(w, j) >= 10 * 365) },
  { id: 'journeyman', group: 'Career', title: 'Journeyman', hint: 'Coach four clubs.', reached: (w) => new Set(w.career.jobs.map((j) => j.clubId)).size >= 4 },
  {
    id: 'globetrotter', group: 'Career', title: 'Globetrotter', hint: 'Coach clubs in three countries.',
    reached: (w) => new Set(w.career.jobs.map((j) => w.clubs[j.clubId]?.nation)).size >= 3,
  },
  { id: 'veteran', group: 'Career', title: 'Old hand', hint: 'Ten seasons as a coach.', reached: (w) => w.career.jobs.reduce((s, j) => s + daysInJob(w, j), 0) >= 10 * 365 },
  { id: 'worldClass', group: 'Career', title: 'World-class', hint: 'Make your name one the whole sport knows.', reached: (w) => w.career.reputation >= 8000 },
];

/** Each day: anything newly reached is unlocked, dated, and the manager hears. */
export function achievementsDay(world: World): void {
  // A career changed in the editor earns none.
  if (world.edited === true) return;
  const career = world.career;
  // A promotion: the club he coaches gone up a division since he last looked.
  const job = career.jobs[career.jobs.length - 1];
  const club = job !== undefined && job.endDay < 0 ? world.clubs[job.clubId] : undefined;
  if (club !== undefined) {
    const last = career.lastTier;
    if (last !== undefined && last.clubId === club.id && club.tier < last.tier) career.promoted = true;
    career.lastTier = { clubId: club.id, tier: club.tier };
  }
  const got = (career.achievements ??= {});
  for (const a of ACHIEVEMENTS) {
    if (got[a.id] !== undefined || !a.reached(world)) continue;
    got[a.id] = world.day;
    postMessage(world, {
      category: 'career', from: 'Your career',
      subject: `Achievement: ${a.title}`,
      body: `${a.hint.replace(/\.$/, '')} — done. It goes in your career's record.`,
    });
  }
}

/** For the screen: every achievement, reached or not, with the day it was. */
export function achievementList(world: World): Array<Achievement & { day: number | null }> {
  const got = world.career.achievements ?? {};
  return ACHIEVEMENTS.map((a) => ({ ...a, day: got[a.id] ?? null }));
}
