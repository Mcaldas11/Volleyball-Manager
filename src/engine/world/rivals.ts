/**
 * Rivalries.
 *
 * Clubs from the same city play a derby: the city's bragging rights, a full
 * house, a board that takes the result to heart and a dressing room that
 * feels it for days. A country's two leading clubs are rivals too — the
 * classic — picked once, from where they stood the first time anyone asked,
 * and kept for good.
 */

import type { Club } from '../model/club.ts';
import { cityBankFor } from './cities.ts';
import { NATIONS } from './nations.ts';
import type { Fixture, World } from './world.ts';

export type Rivalry = 'derby' | 'classic';

/** Clubs' cities, worked out once a world: a club's name never changes. */
const cities = new WeakMap<World, Map<number, string | null>>();

/** The city a club is from, as its name says — null when the name doesn't say. */
export function clubCity(world: World, club: Club): string | null {
  let known = cities.get(world);
  if (known === undefined) cities.set(world, (known = new Map()));
  const hit = known.get(club.id);
  if (hit !== undefined) return hit;
  const def = NATIONS[club.nation];
  const bank = def !== undefined ? cityBankFor(def.cityGroup ?? def.nameGroup) : undefined;
  // The longest city that fits: "Vibo Valentia", not "Valentia".
  const city = bank?.cities
    .filter((c) => new RegExp(`(^| )${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(club.name))
    .sort((a, b) => b.length - a.length)[0] ?? null;
  known.set(club.id, city);
  return city;
}

/** Each country's classic: its two leading clubs, paired the first time it is asked, and kept. */
function classics(world: World): ReadonlyArray<readonly [number, number]> {
  if (world.classics !== undefined) return world.classics;
  const pairs: Array<[number, number]> = [];
  const byNation = new Map<number, Club[]>();
  for (const c of world.clubs) {
    if (c.tier !== 1 || c.players.length === 0) continue;
    const list = byNation.get(c.nation) ?? [];
    list.push(c);
    byNation.set(c.nation, list);
  }
  for (const list of byNation.values()) {
    if (list.length < 4) continue;
    const [a, b] = [...list].sort((x, y) => y.reputation - x.reputation);
    pairs.push([a.id, b.id]);
  }
  world.classics = pairs;
  return pairs;
}

/** What two clubs are to each other: a derby, the classic, or nothing in particular. */
export function rivalryOf(world: World, a: number, b: number): Rivalry | null {
  if (a === b || a < 0 || b < 0) return null;
  const ca = world.clubs[a];
  const cb = world.clubs[b];
  if (ca === undefined || cb === undefined || ca.nation !== cb.nation) return null;
  const city = clubCity(world, ca);
  if (city !== null && city === clubCity(world, cb)) return 'derby';
  return classics(world).some(([x, y]) => (x === a && y === b) || (x === b && y === a)) ? 'classic' : null;
}

/** A club's rivals: the other clubs of its city, and its classic rival. */
export function rivalsOf(world: World, clubId: number): Array<{ clubId: number; kind: Rivalry }> {
  const club = world.clubs[clubId];
  if (club === undefined) return [];
  return world.clubs
    .filter((c) => c.id !== clubId && c.nation === club.nation && c.players.length > 0)
    .map((c) => ({ clubId: c.id, kind: rivalryOf(world, clubId, c.id) }))
    .filter((r): r is { clubId: number; kind: Rivalry } => r.kind !== null)
    .sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'derby' ? -1 : 1));
}

/** The rivalry a competitive match is played under, if any. */
export function fixtureRivalry(world: World, f: Fixture): Rivalry | null {
  const comp = world.competitions[f.competitionId];
  if (comp === undefined || comp.kind === 'friendly' || comp.kind === 'international') return null;
  return rivalryOf(world, f.home, f.away);
}

/** What the papers call it: "the Kraków derby", "the classic". */
export function rivalryName(world: World, f: Fixture): string | null {
  const kind = fixtureRivalry(world, f);
  if (kind === null) return null;
  if (kind === 'classic') return 'the classic';
  const city = clubCity(world, world.clubs[f.home]);
  return city !== null ? `the ${city} derby` : 'the derby';
}
