/**
 * The pre-season training camp: a week away together before the season.
 *
 * Three kinds, three prices. At home, the squad living in the club's own
 * facilities for a week: cheap, and good for the group. At altitude, in the
 * mountains: hard, physical work — the younger players come back with more in
 * their legs, everyone comes back tired for a few days. Abroad, somewhere warm:
 * the dearest, and the one that brings a squad together — morale up and the
 * dressing room tight for months.
 *
 * A camp is booked in the pre-season, for a week with no match in it, and
 * paid for when booked; it is over when the week is, and the manager gets the
 * staff's word on how it went. What it does for the room (see dressingRoom.ts)
 * fades over the autumn.
 */

import type { Club } from '../model/club.ts';
import { refreshAbility } from '../model/ability.ts';
import { calendarOf } from './calendar.ts';
import { postMessage } from './inbox.ts';
import { dayOfSeason, euros, type World } from './world.ts';

export type CampKind = 'home' | 'altitude' | 'abroad';

export const CAMP_KINDS: readonly CampKind[] = ['home', 'altitude', 'abroad'];

export const CAMPS: Readonly<Record<CampKind, { name: string; blurb: string; price: number; bond: number; morale: number }>> = {
  home: { name: 'At home', blurb: 'A week living in at the club: cheap, and good for the group.', price: 0.25, bond: 4, morale: 2 },
  altitude: {
    name: 'At altitude', blurb: 'Hard, physical work in the mountains: the young players come back stronger — and everyone tired.',
    price: 0.6, bond: 3, morale: 1,
  },
  abroad: { name: 'Abroad', blurb: 'A week somewhere warm: the dearest, and the one that brings a squad together.', price: 1, bond: 9, morale: 5 },
};

export interface Camp {
  kind: CampKind;
  season: number;
  /** First and last day, absolute. */
  start: number;
  end: number;
  cost: number;
  done?: boolean;
}

/** How long a camp lasts, days, and how far ahead it must be booked. */
export const CAMP_DAYS = 7;
const NOTICE = 3;
/** How long the camp's lift to the room takes to fade, days. */
export const BOND_DAYS = 100;

/** What a camp of a kind costs a club. */
export function campCost(club: Club, kind: CampKind): number {
  return Math.round(((20_000 + club.reputation * 4) * CAMPS[kind].price) / 1000) * 1000;
}

/** The first and last day a camp can start this pre-season, absolute — or null once it is over. */
export function campWindow(world: World): { first: number; last: number } | null {
  const start = world.day - dayOfSeason(world);
  const last = start + calendarOf(world).leagueStart - CAMP_DAYS - 7;
  const first = world.day + NOTICE;
  return first <= last ? { first, last } : null;
}

/** Why a camp can't be booked for this start — or null if it can. */
export function campBlock(world: World, club: Club, kind: CampKind, start: number): string | null {
  if (club.camp !== undefined && club.camp.season === world.season) return 'There is a camp booked for this pre-season already.';
  const window = campWindow(world);
  if (window === null) return 'The pre-season is too far gone for a camp — next summer.';
  if (start < window.first || start > window.last) return 'Pick a week in the pre-season, a few days ahead at least.';
  for (let d = start - 1; d <= start + CAMP_DAYS; d++) {
    for (const id of world.fixturesByDay.get(d) ?? []) {
      const f = world.fixtures[id];
      if (f.home === club.id || f.away === club.id) return 'There is a match that week — the camp needs a week clear.';
    }
  }
  const cost = campCost(club, kind);
  if (club.finances.balance < cost) return `The club can't afford it: ${euros(cost)}.`;
  return null;
}

/** Book a camp: paid for now. Returns what the manager is told. */
export function bookCamp(world: World, club: Club, kind: CampKind, start: number): string {
  const block = campBlock(world, club, kind, start);
  if (block !== null) return block;
  const cost = campCost(club, kind);
  club.finances.balance -= cost;
  club.camp = { kind, season: world.season, start, end: start + CAMP_DAYS - 1, cost };
  return `Booked: a training camp ${CAMPS[kind].name.toLowerCase()}, ${euros(cost)}.`;
}

/** How much a camp is still lifting a club's room, in cohesion points. */
export function bondOf(world: World, clubId: number): number {
  const b = world.roomBond?.[clubId];
  if (b === undefined) return 0;
  const left = 1 - (world.day - b.day) / BOND_DAYS;
  return left > 0 ? b.amount * left : 0;
}

/** Each day: a camp just over does what it does, and the staff report on it. The manager's club only. */
export function campDay(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const camp = club?.camp;
  if (club === undefined || camp === undefined || camp.done === true || world.day < camp.end) return;
  camp.done = true;
  const kind = CAMPS[camp.kind];
  const store = world.players;
  (world.roomBond ??= {})[club.id] = { day: world.day, amount: kind.bond };
  let stronger = 0;
  for (const p of club.players) {
    if (!store.isActive(p)) continue;
    store.morale[p] = Math.min(100, store.morale[p] + kind.morale);
    if (camp.kind === 'altitude') {
      // A week of it: tired legs now, more in them later — for those young enough to build it.
      store.condition[p] = Math.max(40, store.condition[p] - 12);
      const age = store.ageOn(p, world.year, 181);
      if (age <= 25 && (p * 7919 + world.season) % 3 !== 0) {
        store.setAttr(p, 'stamina', store.getAttr(p, 'stamina') + 1);
        refreshAbility(store, p);
        stronger++;
      }
    }
  }
  postMessage(world, {
    category: 'staff', from: 'Assistant coach',
    subject: `The camp ${kind.name.toLowerCase()} is over`,
    body: camp.kind === 'altitude'
      ? `A hard week in the mountains. ${stronger} of the younger players have come back with more in their legs; everyone is tired, so go easy for a few days.`
      : camp.kind === 'abroad'
        ? 'A great week away: the players have come back as a group, and in high spirits. You will see it in the dressing room for months.'
        : 'A good week living in together at the club. The group is closer for it.',
  });
}
