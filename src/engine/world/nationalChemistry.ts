/**
 * The setter and his hitters at a national team: how well each pair
 * understands each other in their country's shirt.
 *
 * A national side meets a few weeks a year, so it can't build its timing the
 * way a club does, match after match. It builds it in bursts instead: every
 * day a squad is together for a tournament — the week of training before it
 * and every day of it — teaches each setter–hitter pair a little, and every
 * match they share teaches more. Between windows it hardly fades: a pair called
 * up year after year keeps most of what it had. And it starts from somewhere —
 * two internationals with a lot of caps have played together before, and
 * two club-mates bring their club's understanding with them.
 *
 * Kept apart from the clubs' (see chemistry.ts), by nation: what is learnt
 * for a country never touches what a club has, and the other way round.
 */

import { Rng } from '../core/rng.ts';
import { Position } from '../model/positions.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import { CHEM_NEW, chemKey } from './chemistry.ts';
import type { Tournament } from './internationals.ts';
import type { World } from './world.ts';

/** How much of the way to full understanding a day together in a national camp takes a pair. */
export const NATIONAL_DAY_GROWTH = 0.008;
/** And a whole international match on court together. */
export const NATIONAL_MATCH_GROWTH = 0.04;
/** What is kept of a national pair's understanding (above a new pair's) from one season to the next. */
export const NATIONAL_SEASON_KEEP = 0.88;
/** Two internationals with caps to their names have played together before: up to this much over a new pair. */
const CAPS_HEAD_START = 0.4;
/** The fewer caps of the two, at which that head start is about two thirds there. */
const CAPS_SCALE = 30;

/** A national pair's key: the nation, then the setter and the hitter. */
export function nationalChemKey(nation: number, setter: number, hitter: number): number {
  return nation * 1_099_511_627_776 + chemKey(setter, hitter);
}

/** Where a pair with no national history of its own starts: further, the more caps they both have. */
function capsStart(world: World, setter: number, hitter: number): number {
  const caps = Math.min(world.players.nationalCaps[setter] ?? 0, world.players.nationalCaps[hitter] ?? 0);
  return CHEM_NEW + CAPS_HEAD_START * (1 - Math.exp(-caps / CAPS_SCALE));
}

/** What the pair has learnt for this nation, whatever the clubs have. */
function nationalOnly(world: World, nation: number, setter: number, hitter: number): number {
  return world.nationalChemistry?.get(nationalChemKey(nation, setter, hitter)) ?? capsStart(world, setter, hitter);
}

/**
 * How well a setter and a hitter understand each other playing for `nation`, 0 to 1: what they
 * have built for their country — or, if they are club-mates and know each other better there,
 * what they bring from their club.
 */
export function nationalChemistryOf(world: World, nation: number, setter: number, hitter: number): number {
  const own = nationalOnly(world, nation, setter, hitter);
  const store = world.players;
  const club = store.clubId[setter];
  if (club < 0 || club !== store.clubId[hitter]) return own;
  return Math.max(own, world.chemistry?.get(chemKey(setter, hitter)) ?? CHEM_NEW);
}

/** The engine's view of a nation's understanding: a function of setter and hitter. */
export function nationalChemistryFor(world: World, nation: number): (setter: number, hitter: number) => number {
  return (setter, hitter) => nationalChemistryOf(world, nation, setter, hitter);
}

/** A pair a little closer: `rate` of the way to full understanding, from where they stand for the nation. */
function grow(world: World, nation: number, setter: number, hitter: number, rate: number): void {
  const map = (world.nationalChemistry ??= new Map());
  const was = nationalOnly(world, nation, setter, hitter);
  map.set(nationalChemKey(nation, setter, hitter), was + (1 - was) * rate);
}

/** Who sets and who hits in a squad. */
function split(world: World, players: readonly number[]): { setters: number[]; hitters: number[] } {
  const pos = world.players.position;
  return {
    setters: players.filter((p) => pos[p] === Position.Setter),
    hitters: players.filter((p) => pos[p] !== Position.Setter && pos[p] !== Position.Libero),
  };
}

/** Where the core of a national side that has been together for years stands — a little short of a club's settled squad. */
const NATIONAL_SETTLED: readonly [number, number] = [0.32, 0.55];

/**
 * Every nation's core as it stands has played together before: each setter–hitter pair of
 * `squads` (each nation's likely fourteen) gets an understanding between building and good.
 * Once, for a new world or a save from before national chemistry was kept.
 */
export function seedNationalChemistry(world: World, squads: ReadonlyArray<readonly [number, readonly number[]]>): void {
  const map = new Map<number, number>();
  const rng = new Rng(`national-chemistry:${world.season}:${squads.length}`);
  for (const [nation, squad] of squads) {
    const { setters, hitters } = split(world, squad);
    for (const s of setters) {
      for (const h of hitters) {
        map.set(nationalChemKey(nation, s, h), NATIONAL_SETTLED[0] + rng.float() * (NATIONAL_SETTLED[1] - NATIONAL_SETTLED[0]));
      }
    }
  }
  world.nationalChemistry = map;
}

/** A day of a tournament: every nation's squad still together trains together, each pair a little closer. */
export function nationalCampDay(world: World, t: Tournament): void {
  if (t.status !== 'called' && t.status !== 'pools' && t.status !== 'knockout') return;
  for (const [nation, squad] of t.squads) {
    if (t.out.includes(nation)) continue;
    const { setters, hitters } = split(world, squad);
    for (const s of setters) for (const h of hitters) grow(world, nation, s, h, NATIONAL_DAY_GROWTH);
  }
}

/** An international played: the setters and hitters who were on court together, the more so the more of it they shared. */
export function nationalTogether(world: World, nation: number, stats: ReadonlyMap<number, PlayerMatchStats>): void {
  const on = [...stats].filter(([, s]) => s.ralliesPlayed > 0);
  if (on.length === 0) return;
  const pos = world.players.position;
  const most = Math.max(...on.map(([, s]) => s.ralliesPlayed));
  for (const [s, ss] of on) {
    if (pos[s] !== Position.Setter) continue;
    for (const [h, hs] of on) {
      if (h === s || pos[h] === Position.Setter || pos[h] === Position.Libero) continue;
      grow(world, nation, s, h, NATIONAL_MATCH_GROWTH * (Math.min(ss.ralliesPlayed, hs.ralliesPlayed) / most));
    }
  }
}

/** The summer: national pairs fade only a little, and those with a retired player are forgotten. */
export function summerNationalChemistry(world: World): void {
  const map = world.nationalChemistry;
  if (map === undefined) return;
  const store = world.players;
  for (const [key, c] of map) {
    const pair = key % 1_099_511_627_776;
    const s = Math.floor(pair / 1048576);
    const h = pair - s * 1048576;
    if (!store.isActive(s) || !store.isActive(h)) map.delete(key);
    else map.set(key, CHEM_NEW + (c - CHEM_NEW) * NATIONAL_SEASON_KEEP);
  }
}
