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
 *
 * A room has its groups, too: the players from each country, the young ones,
 * the veterans. A foreigner alone in his first season is isolated; a big
 * clique from one country abroad keeps to itself; a group that is unhappy
 * drags the room down; and a squad with a few veterans to steady it holds
 * together better than one without. Each week every group's mood draws its
 * members together. The vice-captain takes the armband if the captain goes,
 * which spares the room much of the shock.
 */

import { bondOf } from './camp.ts';
import type { Club } from '../model/club.ts';
import { hasTrait, Trait } from '../model/traits.ts';
import { spellsOf } from './clubHistory.ts';
import { postMessage } from './inbox.ts';
import { NATIONS } from './nations.ts';
import type { World } from './world.ts';

export type RoomTier = 'leader' | 'influential' | 'other';

export interface RoomMember {
  p: number;
  influence: number;
  tier: RoomTier;
  /** Seasons he has been at the club, this one counting. */
  seasons: number;
}

/** A group in the room: the players from one country, or of one age. */
export interface RoomGroup {
  key: string;
  kind: 'nation' | 'age';
  label: string;
  /** Heaviest first. */
  members: number[];
  /** The group's average morale. */
  mood: number;
}

/** What the room's groups do to its cohesion, and why. */
export interface GroupEffect {
  points: number;
  why: string;
}

export interface DressingRoom {
  /** Heaviest first. */
  members: RoomMember[];
  captain: number;
  /** -1 when none is named. */
  viceCaptain: number;
  groups: RoomGroup[];
  /** Foreigners in their first season here with nobody from their country. */
  isolated: number[];
  effects: GroupEffect[];
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
    (club.captain === p ? 5 : club.viceCaptain === p ? 3 : 0);
}

/** Age a player counts as young, and as a veteran, in the room. */
const YOUNG = 23;
const VETERAN = 30;

/** The room's groups — by country, by age — and what they do to it. */
export function roomGroups(world: World, club: Club, members: readonly RoomMember[]): { groups: RoomGroup[]; isolated: number[]; effects: GroupEffect[] } {
  const store = world.players;
  const mood = (ps: number[]): number => ps.reduce((s, p) => s + store.morale[p], 0) / Math.max(1, ps.length);
  const byNation = new Map<number, number[]>();
  for (const m of members) {
    const list = byNation.get(store.nation[m.p]) ?? [];
    list.push(m.p);
    byNation.set(store.nation[m.p], list);
  }
  const groups: RoomGroup[] = [];
  for (const [n, ps] of byNation) {
    if (ps.length < 2) continue;
    const name = NATIONS[n]?.name ?? 'Abroad';
    groups.push({ key: `n${n}`, kind: 'nation', label: n === club.nation ? `${name} (home)` : name, members: ps, mood: mood(ps) });
  }
  groups.sort((a, b) => b.members.length - a.members.length);
  const age = (p: number): number => store.ageOn(p, world.year, 181);
  const young = members.filter((m) => age(m.p) <= YOUNG).map((m) => m.p);
  const veterans = members.filter((m) => age(m.p) >= VETERAN).map((m) => m.p);
  if (young.length >= 2) groups.push({ key: 'young', kind: 'age', label: `The young ones (${YOUNG} and under)`, members: young, mood: mood(young) });
  if (veterans.length >= 2) groups.push({ key: 'veterans', kind: 'age', label: `The veterans (${VETERAN}+)`, members: veterans, mood: mood(veterans) });

  const isolated = members
    .filter((m) => store.nation[m.p] !== club.nation && (byNation.get(store.nation[m.p])?.length ?? 0) === 1 && m.seasons === 1 && world.season > 0)
    .map((m) => m.p);
  const effects: GroupEffect[] = [];
  if (isolated.length > 0) {
    effects.push({ points: -Math.min(5, isolated.length * 1.5), why: `${isolated.length} foreign newcomer${isolated.length === 1 ? '' : 's'} with nobody from home` });
  }
  const clique = groups.find((g) => g.kind === 'nation' && g.key !== `n${club.nation}` && g.members.length >= 4 && g.members.length >= members.length * 0.3);
  if (clique !== undefined) effects.push({ points: -3, why: `the ${clique.label} group keeps to itself` });
  const unhappy = groups.filter((g) => g.members.length >= 3 && g.mood < 40);
  for (const g of unhappy.slice(0, 2)) effects.push({ points: -4, why: `${g.label}: an unhappy group` });
  if (veterans.length >= 2) effects.push({ points: 2, why: 'veterans to steady the room' });
  else if (members.length >= 8) effects.push({ points: -2, why: 'no veterans to steady the room' });
  return { groups, isolated, effects };
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
  const viceCaptain = club.viceCaptain !== undefined && club.players.includes(club.viceCaptain) && club.viceCaptain !== captain ? club.viceCaptain : -1;
  const leaderMorale = leaders.length > 0 ? leaders.reduce((s, m) => s + store.morale[m.p], 0) / leaders.length : 60;
  const newcomers = members.filter((m) => m.seasons === 1 && world.season > 0).length;
  const tenure = members.length > 0 ? members.reduce((s, m) => s + Math.min(5, m.seasons), 0) / members.length : 1;
  const { groups, isolated, effects } = roomGroups(world, club, members);
  const groupPoints = Math.max(-12, Math.min(4, effects.reduce((s, e) => s + e.points, 0)));
  const cohesion = 35 + tenure * 9 - newcomers * 2.5 + (leaderMorale - 60) * 0.25 - shockOf(world, club.id) + groupPoints +
    bondOf(world, club.id);
  return {
    members, captain, viceCaptain, groups, isolated, effects,
    cohesion: Math.round(Math.max(5, Math.min(100, cohesion))), leaderMorale, newcomers,
  };
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
  if (!club.players.includes(p)) return;
  club.captain = p;
  if (club.viceCaptain === p) club.viceCaptain = undefined;
}

/** Pick the vice-captain. */
export function setViceCaptain(club: Club, p: number): void {
  if (!club.players.includes(p) || club.captain === p) return;
  club.viceCaptain = p;
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
    // A group's mood draws its members together: a little each week.
    for (const g of room.groups) {
      if (g.members.length < 3) continue;
      for (const p of g.members) {
        const pull = Math.sign(g.mood - store.morale[p]) * Math.min(1, Math.abs(g.mood - store.morale[p]) * 0.05);
        store.morale[p] = Math.max(0, Math.min(100, Math.round(store.morale[p] + pull)));
      }
    }
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
  if (club.viceCaptain === p) club.viceCaptain = undefined;
  const leader = room.members.find((m) => m.p === p && m.tier === 'leader');
  if (leader === undefined) return;
  // A vice-captain ready to take the armband spares the room much of it.
  const heir = room.captain === p && room.viceCaptain >= 0 ? room.viceCaptain : -1;
  const amount = room.captain === p ? (heir >= 0 ? 6 : 12) : 8;
  (world.roomShock ??= {})[club.id] = { day: world.day, amount: Math.max(amount, shockOf(world, club.id)) };
  if (club.captain === p) club.captain = heir >= 0 ? heir : undefined;
  if (heir >= 0) club.viceCaptain = undefined;
  const store = world.players;
  for (const m of room.members) if (m.p !== p) store.morale[m.p] = Math.max(0, store.morale[m.p] - 2);
  if (club.id === world.userClubId) {
    postMessage(world, {
      category: 'news',
      from: 'Dressing room',
      subject: `The squad feels ${store.fullName(p)}'s departure`,
      body: `${store.fullName(p)} was one of the voices the dressing room listened to${room.captain === p ? ' — and its captain' : ''}. ` +
        (heir >= 0
          ? `${store.fullName(heir)}, his vice-captain, takes the armband — the squad knew it would be him, and it has settled quicker for it.`
          : 'His going has unsettled the squad for now: it will take a while for the rest to fill the gap.'),
      playerIdx: p,
    });
  }
}
