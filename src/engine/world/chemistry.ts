/**
 * The setter and his hitters: how well each pair understands each other.
 *
 * A set is only as good as the hitter's timing on it, and that timing is
 * learnt — the height a setter likes for the outside, the tempo of the quick,
 * where the ball comes out of his hands on a back set. A pair who have played
 * together for seasons hardly need to look; a hitter signed last week is still
 * a beat early or late. So every setter–hitter pair at a club has a
 * chemistry, 0 to 1, that grows with every match they play together — fast at
 * first, then slower — eases a little over a summer apart, and is gone when
 * one of them leaves. In the engine a pair that has it gets the ball on time a
 * little more often — the quick, all timing, most of all (see engine.ts).
 *
 * Kept for every club, as each squad changes, so a side that keeps its spine
 * together gets the better of one rebuilt every summer.
 */

import { Rng } from '../core/rng.ts';
import { Position } from '../model/positions.ts';
import type { PlayerMatchStats } from '../match/stats.ts';
import { postMessage } from './inbox.ts';
import type { World } from './world.ts';

/** Where a pair who have never played together start, and where a squad already together does. */
export const CHEM_NEW = 0.15;
const CHEM_SETTLED: readonly [number, number] = [0.42, 0.75];
/** How much of the way to full understanding a whole match together takes them. */
const GROWTH = 0.055;
/** What a summer apart takes off. */
const SUMMER = 0.92;
/** Where a pair is said to have clicked — the manager hears of it. */
export const CLICKED = 0.8;

/** A pair's key: the setter, then the hitter. */
export function chemKey(setter: number, hitter: number): number {
  return setter * 1048576 + hitter;
}

/** How well a setter and a hitter understand each other, 0 to 1. */
export function chemistryOf(world: World, setter: number, hitter: number): number {
  return world.chemistry?.get(chemKey(setter, hitter)) ?? CHEM_NEW;
}

/** Words for it. */
export function chemistryLabel(c: number): string {
  return c >= CLICKED ? 'Telepathic' : c >= 0.6 ? 'Strong' : c >= 0.4 ? 'Good' : c >= 0.25 ? 'Building' : 'New';
}

/** Who sets, and who hits, among a club's players. */
function split(world: World, players: readonly number[]): { setters: number[]; hitters: number[] } {
  const store = world.players;
  const setters = players.filter((p) => store.position[p] === Position.Setter);
  const hitters = players.filter((p) => store.position[p] !== Position.Setter && store.position[p] !== Position.Libero);
  return { setters, hitters };
}

/**
 * Every club's squad as it stands is a squad that has trained together: each
 * pair gets an understanding somewhere between good and strong. For a new
 * world, and for a save from before chemistry was kept.
 */
export function seedChemistry(world: World): void {
  const map = new Map<number, number>();
  const rng = new Rng(`chemistry:${world.season}:${world.clubs.length}`);
  for (const club of world.clubs) {
    const { setters, hitters } = split(world, club.players);
    for (const s of setters) {
      for (const h of hitters) map.set(chemKey(s, h), CHEM_SETTLED[0] + rng.float() * (CHEM_SETTLED[1] - CHEM_SETTLED[0]));
    }
  }
  world.chemistry = map;
}

/**
 * A match played: every setter who was on court and every hitter who was get to know each other
 * a little better, the more so the more of it they shared. Whoever reaches the point where they
 * click, at the manager's club, makes his assistant's report.
 */
export function noteTogether(world: World, ...sides: ReadonlyArray<Map<number, PlayerMatchStats>>): void {
  const map = (world.chemistry ??= new Map());
  const store = world.players;
  for (const stats of sides) {
    const on = [...stats].filter(([, s]) => s.ralliesPlayed > 0);
    if (on.length === 0) continue;
    const most = Math.max(...on.map(([, s]) => s.ralliesPlayed));
    for (const [s, ss] of on) {
      if (store.position[s] !== Position.Setter) continue;
      for (const [h, hs] of on) {
        if (h === s || store.position[h] === Position.Setter || store.position[h] === Position.Libero) continue;
        const shared = Math.min(ss.ralliesPlayed, hs.ralliesPlayed) / most;
        const key = chemKey(s, h);
        const was = map.get(key) ?? CHEM_NEW;
        const now = was + (1 - was) * GROWTH * shared;
        map.set(key, now);
        const club = store.clubId[s];
        if (was < CLICKED && now >= CLICKED && club === world.userClubId && store.clubId[h] === club) {
          postMessage(world, {
            category: 'staff',
            from: 'Assistant coach',
            subject: `${store.shortName(s)} and ${store.shortName(h)} have clicked`,
            body: `${store.fullName(s)} and ${store.fullName(h)} are reading each other perfectly now — ` +
              `${store.shortName(h)} is on every set before it leaves ${store.shortName(s)}'s hands. ` +
              'Keep them on court together and that understanding is worth points.',
            playerIdx: h,
          });
        }
      }
    }
  }
}

/**
 * The summer: pairs who are no longer at the same club are forgotten, and the rest lose a little
 * of their edge over the break.
 */
export function summerChemistry(world: World): void {
  const map = world.chemistry;
  if (map === undefined) return;
  const store = world.players;
  for (const [key, c] of map) {
    const s = Math.floor(key / 1048576);
    const h = key - s * 1048576;
    const club = store.clubId[s];
    if (club < 0 || club !== store.clubId[h] || !store.isActive(s) || !store.isActive(h)) map.delete(key);
    else map.set(key, CHEM_NEW + (c - CHEM_NEW) * SUMMER);
  }
}

/** A club's pairs, for the screens: each setter with each of his hitters. */
export function clubChemistry(world: World, players: readonly number[]): Array<{ setter: number; hitter: number; c: number }> {
  const { setters, hitters } = split(world, players);
  const out: Array<{ setter: number; hitter: number; c: number }> = [];
  for (const s of setters) for (const h of hitters) out.push({ setter: s, hitter: h, c: chemistryOf(world, s, h) });
  return out;
}

/** The engine's view of it: a function of setter and hitter. */
export function chemistryFor(world: World): (setter: number, hitter: number) => number {
  return (setter, hitter) => chemistryOf(world, setter, hitter);
}
