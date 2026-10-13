/**
 * Coaching courses: the manager going back to school.
 *
 * The licences come in order — Level 2, Level 1, then the Pro licence, for a
 * coach with a name — each a few months of study alongside the job, lifting
 * his tactics and his handling of people, and what the sport thinks of him.
 * The clinics are short courses on one part of the game, each worth a point
 * on two of his attributes, and each to be taken once a season. One course at
 * a time; the club pays the fee — or, for a coach out of work, the federation.
 */

import type { StaffAttributes } from '../model/staff.ts';
import { ensureManagerAttributes } from './career.ts';
import { postMessage } from './inbox.ts';
import { euros, type World } from './world.ts';

export type Licence = 'L2' | 'L1' | 'Pro';

export const LICENCE_NAMES: Readonly<Record<Licence, string>> = { L2: 'Level 2 licence', L1: 'Level 1 licence', Pro: 'Pro licence' };

export interface Course {
  id: string;
  name: string;
  /** What it teaches: these attributes, by `gain` each. */
  attrs: ReadonlyArray<keyof StaffAttributes>;
  gain: number;
  days: number;
  fee: number;
  licence?: Licence;
  /** The licence a licence course needs first, and the name it wants. */
  needs?: Licence;
  minReputation?: number;
  /** What it does for the name. */
  reputation?: number;
}

export const COURSES: readonly Course[] = [
  { id: 'L2', name: 'Level 2 coaching licence', licence: 'L2', attrs: ['coachTactical', 'manManagement', 'motivating'], gain: 1, days: 60, fee: 5_000, reputation: 100 },
  { id: 'L1', name: 'Level 1 coaching licence', licence: 'L1', needs: 'L2', attrs: ['coachTactical', 'coachMental', 'discipline', 'adaptability'], gain: 1, days: 90, fee: 15_000, reputation: 200 },
  { id: 'Pro', name: 'Pro licence', licence: 'Pro', needs: 'L1', minReputation: 3000, attrs: ['coachTactical', 'manManagement', 'motivating'], gain: 2, days: 150, fee: 40_000, reputation: 400 },
  { id: 'serveReceive', name: 'Serve & receive clinic', attrs: ['coachServing', 'coachReception'], gain: 1, days: 30, fee: 8_000 },
  { id: 'attackBlock', name: 'Attack & block clinic', attrs: ['coachAttacking', 'coachBlocking'], gain: 1, days: 30, fee: 8_000 },
  { id: 'setting', name: 'Setting & systems workshop', attrs: ['coachSetting', 'coachTactical'], gain: 1, days: 30, fee: 8_000 },
  { id: 'psychology', name: 'Sports psychology', attrs: ['coachMental', 'motivating'], gain: 1, days: 30, fee: 8_000 },
  { id: 'science', name: 'Sports science', attrs: ['coachFitness', 'sportsScience'], gain: 1, days: 30, fee: 8_000 },
  { id: 'youth', name: 'Youth development', attrs: ['workingWithYouth', 'potentialAssessment'], gain: 1, days: 30, fee: 6_000 },
  { id: 'talent', name: 'Talent identification', attrs: ['judgingAbility', 'potentialAssessment'], gain: 1, days: 30, fee: 6_000 },
  { id: 'leadership', name: 'Leadership & man management', attrs: ['manManagement', 'discipline'], gain: 1, days: 30, fee: 8_000 },
];

const LICENCE_ORDER: readonly Licence[] = ['L2', 'L1', 'Pro'];

/** The highest licence the manager holds, if any. */
export function licenceOf(world: World): Licence | null {
  return world.career.licence ?? null;
}

function holds(world: World, l: Licence): boolean {
  const mine = licenceOf(world);
  return mine !== null && LICENCE_ORDER.indexOf(mine) >= LICENCE_ORDER.indexOf(l);
}

/** Why he can't start a course now — or null when he can. */
export function courseBlock(world: World, c: Course): string | null {
  const career = world.career;
  if (career.course !== undefined) return 'You are on a course already — one at a time.';
  if (c.licence !== undefined && holds(world, c.licence)) return 'You hold it already.';
  if (c.needs !== undefined && !holds(world, c.needs)) return `It needs the ${LICENCE_NAMES[c.needs]} first.`;
  if (c.minReputation !== undefined && career.reputation < c.minReputation) return 'It is for coaches with more of a name.';
  if (c.licence === undefined && (career.clinics ?? []).some((x) => x.id === c.id && x.season === world.season)) return 'You took it this season.';
  const attrs = ensureManagerAttributes(world);
  if (c.attrs.every((k) => attrs[k] >= 20)) return 'It has nothing left to teach you.';
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club !== undefined && club.finances.balance < c.fee) return 'The club can\'t pay the fee.';
  return null;
}

/** Enrol. Returns what happened, or why not. */
export function startCourse(world: World, id: string): { ok: boolean; text: string } {
  const c = COURSES.find((x) => x.id === id);
  if (c === undefined) return { ok: false, text: 'No such course.' };
  const block = courseBlock(world, c);
  if (block !== null) return { ok: false, text: block };
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club !== undefined) club.finances.balance -= c.fee;
  world.career.course = { id: c.id, started: world.day, until: world.day + c.days };
  return {
    ok: true,
    text: `You have enrolled on the ${c.name}: ${Math.round(c.days / 7)} weeks alongside the job` +
      (club !== undefined ? `, ${euros(c.fee)} paid by the club.` : ', paid for by the federation.'),
  };
}

/** Each day: a course finished. */
export function coursesDay(world: World): void {
  const career = world.career;
  const run = career.course;
  if (run === undefined || run.until > world.day) return;
  career.course = undefined;
  const c = COURSES.find((x) => x.id === run.id);
  if (c === undefined) return;
  const attrs = ensureManagerAttributes(world);
  const grown: string[] = [];
  for (const k of c.attrs) {
    const was = attrs[k];
    attrs[k] = Math.min(20, attrs[k] + c.gain);
    if (attrs[k] > was) grown.push(String(k));
  }
  if (c.licence !== undefined) career.licence = c.licence;
  else (career.clinics ??= []).push({ id: c.id, season: world.season });
  if (c.reputation !== undefined) career.reputation = Math.min(10000, career.reputation + c.reputation);
  postMessage(world, {
    category: 'career', from: 'Coaching Federation',
    subject: c.licence !== undefined ? `You have your ${LICENCE_NAMES[c.licence]}` : `Course completed: ${c.name}`,
    body: `You have completed the ${c.name}.` +
      (grown.length > 0 ? ' It shows in your coaching — your attributes are on your profile.' : '') +
      (c.reputation !== undefined ? ' And the sport has taken note of the qualification.' : ''),
  });
}
