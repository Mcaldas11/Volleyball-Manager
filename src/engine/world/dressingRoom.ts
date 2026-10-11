/**
 * The dressing room: who the squad listens to, and how well it holds together.
 *
 * Every player has his weight in it — his leadership, his years in the game
 * and at the club, his caps and his class, and a vocal leader counts for more.
 * The heaviest are its leaders, the next its influential men, and one of the
 * leaders wears the armband: the manager's choice, or the room's.
 *
 * Cohesion is how well it holds together, 0-100: a squad that has been
 * together for years is tight, one full of new faces is not, and losing a
 * leader shakes it for a while. A tight squad plays a little above itself; a
 * loose one a little below. And the leaders' mood is the room's: when they
 * are down, the rest follow.
 */

import type { Club } from '../model/club.ts';
import { hasTrait, Trait } from '../model/traits.ts';
import { spellsOf } from './clubHistory.ts';
import { postMessage } from './inbox.ts';
import type { World } from './world.ts';

export type RoomTier = 'leader' | 'influential' | 'other';

export interface RoomMember {
  p: number;
  influence: number;
  tier: RoomTier;
  /** Seasons he has been at the club, this one counting. */
  seasons: number;
}

export interface DressingRoom {
  /** Heaviest first. */
  members: RoomMember[];
  captain: number;
  cohesion: number;
  /** The leaders' average morale. */
  leaderMorale: number;
  /** Players in their first season at the club. */
  newcomers: number;
}

export const ROOM_TIER_NAMES: Readonly<Record<RoomTier, string>> = {
  leader: 'Team leaders', influential: 'Highly influential', other: 'Other players',
};

const LEADERS = 3;
const INFLUENTIAL = 4;
/** Cohesion an established squad settles at. */
export const NEUTRAL_COHESION = 60;
/** What cohesion is worth on court: a tight squad this much above itself at most, a loose one below. */
const COHESION_EDGE = 0.025;
/** How long losing a leader unsettles the room, in days. */
const SHOCK_DAYS = 90;

/** Seasons a player has been at a club, this one counting. */
export function seasonsAtClub(world: World, p: number, clubId: number): number {
  const spells = spellsOf(world, p);
  const last = spells[spells.length - 1];
  if (last === undefined || last.club !== clubId) return 1;
  return Math.max(1, world.season - last.from + 1);
}

/** How much a player counts for in his club's dressing room. */
export function influenceOf(world: World, club: Club, p: number, seasons = seasonsAtClub(world, p, club.id)): number {
  const store = world.players;
  const age = store.ageOn(p, world.year, 181);
  return store.getAttr(p, 'leadership') * 2 +
    Math.min(10, Math.max(0, age - 20)) * 0.8 +
    Math.min(6, seasons) * 1.5 +
    Math.min(8, store.nationalCaps[p] / 25) +
    store.currentAbility[p] / 150 +
    (hasTrait(store.traits[p], Trait.VocalLeader) ? 6 : 0) +
    (club.captain === p ? 5 : 0);
}

/** How unsettled the room still is by a leader's departure, in cohesion points. */
function shockOf(world: World, clubId: number): number {
  const s = world.roomShock?.[clubId];
  if (s === undefined) return 0;
  const left = 1 - (world.day - s.day) / SHOCK_DAYS;
  return left > 0 ? s.amount * left : 0;
}

/** A club's dressing room as it stands. */
export function dressingRoom(world: World, club: Club): DressingRoom {
  const store = world.players;
  const members: RoomMember[] = club.players
    .filter((p) => store.isActive(p))
    .map((p) => {
      const seasons = seasonsAtClub(world, p, club.id);
      return { p, seasons, influence: influenceOf(world, club, p, seasons), tier: 'other' as RoomTier };
    })
    .sort((a, b) => b.influence - a.influence);
  members.forEach((m, i) => { m.tier = i < LEADERS ? 'leader' : i < LEADERS + INFLUENTIAL ? 'influential' : 'other'; });
  const leaders = members.filter((m) => m.tier === 'leader');
  const captain = club.captain !== undefined && club.players.includes(club.captain) ? club.captain : leaders[0]?.p ?? -1;
  const leaderMorale = leaders.length > 0 ? leaders.reduce((s, m) => s + store.morale[m.p], 0) / leaders.length : 60;
  const newcomers = members.filter((m) => m.seasons === 1 && world.season > 0).length;
  const tenure = members.length > 0 ? members.reduce((s, m) => s + Math.min(5, m.seasons), 0) / members.length : 1;
  const cohesion = 35 + tenure * 9 - newcomers * 2.5 + (leaderMorale - 60) * 0.25 - shockOf(world, club.id);
  return { members, captain, cohesion: Math.round(Math.max(5, Math.min(100, cohesion))), leaderMorale, newcomers };
}

/** A club's cohesion as last worked out — every week — or the room's resting level. */
export function cohesionOf(world: World, clubId: number): number {
  return world.cohesion?.[clubId] ?? NEUTRAL_COHESION;
}

/** What cohesion is worth on court: a multiplier on the side's play, a couple of per cent either way. */
export function cohesionEdge(cohesion: number): number {
  return 1 + Math.max(-1, Math.min(1, (cohesion - NEUTRAL_COHESION) / 40)) * COHESION_EDGE;
}

/** Pick the captain. */
export function setCaptain(club: Club, p: number): void {
  if (club.players.includes(p)) club.captain = p;
}

/**
 * The week in every dressing room: its cohesion worked out afresh, and the
 * leaders' mood passed on — down when they are down, up a little when they
 * are happy.
 */
export function dressingRoomWeek(world: World): void {
  const store = world.players;
  const cohesion: Record<number, number> = {};
  for (const club of world.clubs) {
    if (club.players.length === 0) continue;
    const room = dressingRoom(world, club);
    cohesion[club.id] = room.cohesion;
    const lift = room.leaderMorale < 40 ? -1 : room.leaderMorale > 70 ? 0.5 : 0;
    if (lift === 0) continue;
    for (const m of room.members) {
      if (m.tier === 'leader') continue;
      store.morale[m.p] = Math.max(0, Math.min(lift > 0 ? 75 : 100, store.morale[m.p] + lift));
    }
  }
  world.cohesion = cohesion;
}

/**
 * A player leaves a club: if he was one of its leaders, the room feels it —
 * the captain most of all — and the manager hears, if it is his.
 */
export function noteDeparture(world: World, club: Club, p: number): void {
  const room = dressingRoom(world, club);
  const leader = room.members.find((m) => m.p === p && m.tier === 'leader');
  if (leader === undefined) return;
  const amount = room.captain === p ? 12 : 8;
  (world.roomShock ??= {})[club.id] = { day: world.day, amount: Math.max(amount, shockOf(world, club.id)) };
  if (club.captain === p) club.captain = undefined;
  const store = world.players;
  for (const m of room.members) if (m.p !== p) store.morale[m.p] = Math.max(0, store.morale[m.p] - 2);
  if (club.id === world.userClubId) {
    postMessage(world, {
      category: 'news',
      from: 'Dressing room',
      subject: `The squad feels ${store.fullName(p)}'s departure`,
      body: `${store.fullName(p)} was one of the voices the dressing room listened to${room.captain === p ? ' — and its captain' : ''}. ` +
        'His going has unsettled the squad for now: it will take a while for the rest to fill the gap.',
      playerIdx: p,
    });
  }
}
