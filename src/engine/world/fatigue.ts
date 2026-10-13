/**
 * Travel, and a crowded calendar.
 *
 * A side playing away travels the day before: a short trip is nothing, but a
 * long one across a big country costs some condition, and a flight abroad
 * more; at a neutral venue both sides travel.
 * And every match played adds to a player's load, which ebbs away a little
 * each day: a player who has played three in a week recovers more slowly
 * than one fresh from a rest, so a crowded run of fixtures wears a side down
 * unless it rotates.
 */

import type { Fixture, World } from './world.ts';
import { NATIONS } from './nations.ts';
import { clubCity } from './rivals.ts';

/** Condition a trip costs: across town or a small country; across a big one; abroad. */
export const TRAVEL_COST = { short: 0, long: 2, abroad: 5 } as const;

/** Countries big enough that an away match is a long trip. */
const BIG_COUNTRIES = new Set(['BRA', 'RUS', 'USA', 'CHN', 'CAN', 'ARG', 'AUS', 'IND', 'KAZ', 'MEX', 'IRI', 'TUR']);

export type Trip = keyof typeof TRAVEL_COST;

/** The trip a club makes to a fixture — null when it plays at home. */
export function tripTo(world: World, f: Fixture, clubId: number): Trip | null {
  if (f.home === clubId && f.neutralVenue !== true) return null;
  const club = world.clubs[clubId];
  const other = world.clubs[f.home === clubId ? f.away : f.home];
  if (club === undefined || other === undefined) return null;
  // At a neutral venue, a final abroad when the clubs are from different countries.
  if (club.nation !== other.nation) return 'abroad';
  // Across town.
  const city = clubCity(world, club);
  if (city !== null && city === clubCity(world, other)) return 'short';
  return BIG_COUNTRIES.has(NATIONS[club.nation]?.code ?? '') ? 'long' : 'short';
}

/**
 * The eve of a match day: every side playing away tomorrow travels today.
 * Called once the day has turned, for the fixtures of the new day — so the
 * side that travelled kicks off with it in its legs.
 */
export function travelEve(world: World): void {
  const todays = world.fixturesByDay.get(world.day);
  if (todays === undefined) return;
  const store = world.players;
  for (const id of todays) {
    const f = world.fixtures[id];
    const comp = world.competitions[f.competitionId];
    if (f.played || comp === undefined || comp.kind === 'international') continue;
    for (const clubId of [f.home, f.away]) {
      const trip = tripTo(world, f, clubId);
      if (trip === null || TRAVEL_COST[trip] === 0) continue;
      const club = world.clubs[clubId];
      if (club === undefined) continue;
      for (const p of club.players) store.condition[p] = Math.max(20, store.condition[p] - TRAVEL_COST[trip]);
    }
  }
}

/** Load added by a match played in full; it ebbs away by this share every day. */
const LOAD_PER_MATCH = 1;
const LOAD_DECAY = 0.86;
/** Load past which recovery slows: about three matches in a week. */
const LOAD_FREE = 1.6;

/** Every player who took part in a match adds it to his load. */
export function noteMatchLoad(world: World, players: Iterable<number>): void {
  const load = (world.matchLoad ??= new Map());
  for (const p of players) load.set(p, (load.get(p) ?? 0) + LOAD_PER_MATCH);
}

/** A player's load: about how many matches he has in his legs, recent ones counting most. */
export function loadOf(world: World, p: number): number {
  return world.matchLoad?.get(p) ?? 0;
}

/** How fast a player recovers for his load: 1 when fresh, less the more he has played lately. */
export function recoveryFactor(world: World, p: number): number {
  const over = loadOf(world, p) - LOAD_FREE;
  return over <= 0 ? 1 : 1 / (1 + 0.35 * over);
}

/** Every day the load ebbs; what is left of it after a long rest goes. */
export function ebbLoads(world: World): void {
  const load = world.matchLoad;
  if (load === undefined) return;
  for (const [p, v] of load) {
    const next = v * LOAD_DECAY;
    if (next < 0.05) load.delete(p);
    else load.set(p, next);
  }
}

/** The club's competitive matches in the coming days, today's included. */
export function fixturesAhead(world: World, clubId: number, days: number): Fixture[] {
  return world.fixtures.filter((f) => !f.played && f.day >= world.day && f.day < world.day + days &&
    (f.home === clubId || f.away === clubId) && world.competitions[f.competitionId]?.kind !== 'friendly');
}
