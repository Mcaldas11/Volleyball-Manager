/**
 * Mentoring: a veteran taking a young player under his wing.
 *
 * The manager pairs a young player — 23 or under — with a senior one, 28 or
 * over, at his club; a veteran can take two at most. The young player comes
 * on quicker for it, the more so the better the mentor leads, works and plays
 * — and most of all when he plays the same position. Some of the mentor rubs
 * off on him: his professionalism, his determination, his composure. And now
 * and then he picks up one of the mentor's traits, if his own game has the
 * makings of it. The pairing lasts until one of them leaves or the young
 * player turns 24.
 */

import type { AttributeName } from '../model/attributes.ts';
import { TRAIT_NAMES, MAX_TRAITS, traitClaim, traitsOf, type Trait } from '../model/traits.ts';
import { postMessage } from './inbox.ts';
import { extraDevelopment } from './progression.ts';
import type { World } from './world.ts';

export interface Mentorship {
  mentor: number;
  mentee: number;
  clubId: number;
  /** Absolute day it began. */
  since: number;
}

export const MENTOR_MIN_AGE = 28;
export const MENTEE_MAX_AGE = 23;
export const MAX_MENTEES = 2;

const age = (world: World, p: number): number => world.players.ageOn(p, world.year, 181);

/** A young player's mentor, if he has one. */
export function mentorOf(world: World, p: number): number | null {
  return world.mentorships?.find((m) => m.mentee === p)?.mentor ?? null;
}

/** The young players a veteran mentors. */
export function menteesOf(world: World, p: number): number[] {
  return (world.mentorships ?? []).filter((m) => m.mentor === p).map((m) => m.mentee);
}

/** Why `mentor` can't take `mentee` under his wing — or null when he can. */
export function mentorBlock(world: World, mentor: number, mentee: number): string | null {
  const store = world.players;
  const club = store.clubId[mentee];
  if (club < 0 || store.clubId[mentor] !== club) return 'They are not at the same club.';
  if (mentor === mentee) return 'He can\'t mentor himself.';
  if (age(world, mentee) > MENTEE_MAX_AGE) return `Only players of ${MENTEE_MAX_AGE} and under are mentored.`;
  if (age(world, mentor) < MENTOR_MIN_AGE) return `A mentor has to be ${MENTOR_MIN_AGE} or over.`;
  if (menteesOf(world, mentor).filter((x) => x !== mentee).length >= MAX_MENTEES) return `He already mentors ${MAX_MENTEES}.`;
  return null;
}

/** Pair a young player with a mentor — or, with null, end his mentoring. Returns what happened. */
export function setMentor(world: World, mentee: number, mentor: number | null): string {
  const store = world.players;
  const list = (world.mentorships ??= []);
  const was = list.findIndex((m) => m.mentee === mentee);
  if (mentor === null) {
    if (was >= 0) list.splice(was, 1);
    return `${store.fullName(mentee)} no longer has a mentor.`;
  }
  const block = mentorBlock(world, mentor, mentee);
  if (block !== null) return block;
  if (was >= 0) list.splice(was, 1);
  list.push({ mentor, mentee, clubId: store.clubId[mentee], since: world.day });
  return `${store.fullName(mentor)} takes ${store.fullName(mentee)} under his wing.`;
}

/** How good a mentor is, 0-1: how he leads, how he works, how well he plays. */
export function mentorQuality(world: World, mentor: number): number {
  const store = world.players;
  return Math.max(0, Math.min(1,
    (store.getAttr(mentor, 'leadership') + store.getAttr(mentor, 'professionalism') + store.currentAbility[mentor] / 100) / 60));
}

/** The weekly chance of a mentored player's extra step of development: the better the mentor, the likelier — most of all in his own position. */
export function mentorChance(world: World, m: Pick<Mentorship, 'mentor' | 'mentee'>): number {
  const store = world.players;
  const same = store.position[m.mentor] === store.position[m.mentee] ? 1 : 0.6;
  return 0.45 * mentorQuality(world, m.mentor) * same;
}

/** What rubs off: the mentor's work and temperament. */
const RUBS_OFF: readonly AttributeName[] = ['professionalism', 'determination', 'workEthic', 'composure'];

/**
 * The week's mentoring: pairings that no longer hold end; something of each
 * mentor rubs off on his player; now and then a trait passes on. Called weekly.
 */
export function mentoringWeek(world: World): void {
  const list = world.mentorships;
  if (list === undefined || list.length === 0) return;
  const store = world.players;
  const rng = world.rng;
  for (const m of [...list]) {
    const together = store.isActive(m.mentor) && store.isActive(m.mentee) &&
      store.clubId[m.mentor] === m.clubId && store.clubId[m.mentee] === m.clubId;
    const grown = age(world, m.mentee) > MENTEE_MAX_AGE;
    if (!together || grown) {
      list.splice(list.indexOf(m), 1);
      if (m.clubId === world.userClubId && together && grown) {
        postMessage(world, {
          category: 'staff', from: 'Assistant Coach', playerIdx: m.mentee,
          subject: `${store.fullName(m.mentee)} has outgrown his mentoring`,
          body: `${store.fullName(m.mentee)} is ${age(world, m.mentee)} now: his time under ${store.fullName(m.mentor)}'s wing is over. ` +
            'He goes on on his own.',
        });
      }
      continue;
    }
    const q = mentorQuality(world, m.mentor);
    // He comes on quicker for it.
    if (rng.chance(mentorChance(world, m))) extraDevelopment(world, m.mentee);
    // Something of the mentor rubs off.
    if (rng.chance(0.06 * q)) {
      const gaps = RUBS_OFF.map((a) => [a, store.getAttr(m.mentor, a) - store.getAttr(m.mentee, a)] as const)
        .filter(([, d]) => d >= 2).sort((x, y) => y[1] - x[1]);
      if (gaps.length > 0) store.setAttr(m.mentee, gaps[0][0], Math.min(20, store.getAttr(m.mentee, gaps[0][0]) + 1));
    }
    // And now and then a trait.
    const own = traitsOf(store, m.mentee);
    if (own.length >= MAX_TRAITS) continue;
    const teachable = traitsOf(store, m.mentor).filter((t) => !own.includes(t) && traitClaim(store, m.mentee, t) >= 0.25);
    if (teachable.length === 0 || !rng.chance(0.035 * q)) continue;
    const t: Trait = teachable[rng.int(0, teachable.length - 1)];
    store.traits[m.mentee] |= 1 << t;
    store.morale[m.mentor] = Math.min(100, store.morale[m.mentor] + 3);
    if (m.clubId === world.userClubId) {
      postMessage(world, {
        category: 'staff', from: 'Assistant Coach', playerIdx: m.mentee,
        subject: `${store.fullName(m.mentee)} picks up a trait`,
        body: `Working with ${store.fullName(m.mentor)} has rubbed off on ${store.fullName(m.mentee)}: he has picked up ` +
          `"${TRAIT_NAMES[t]}" from his mentor.`,
      });
    }
  }
}
