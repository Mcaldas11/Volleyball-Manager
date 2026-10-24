/**
 * Shirt numbers. Every senior player at a club wears a number of his own, 1 to 99, and no two at the
 * same club wear the same one. The manager picks his own players' — giving one a team-mate's number
 * swaps the two over. Everyone else, and anyone who arrives at a club, is given the number he would
 * want or the nearest free one; a newcomer whose old number is taken where he goes gives way to the
 * man who wears it there. A player keeps his number for as long as he stays.
 */

import type { Club } from '../model/club.ts';
import type { World } from './world.ts';

export const MIN_NUMBER = 1;
export const MAX_NUMBER = 99;

/** The number a player would pick, the same in every world: something from 1 to 20. */
function wanted(world: World, p: number): number {
  const id = world.players.id[p];
  return 1 + ((((id * 7) % 20) + 20) % 20);
}

/**
 * Each player at the club and his number — anyone without one, or wearing one a team-mate who has
 * been there longer already wears, given one now (and kept).
 */
export function clubNumbers(world: World, club: Club): Map<number, number> {
  const numbers = (world.shirtNumbers ??= {});
  const out = new Map<number, number>();
  const taken = new Set<number>();
  // Those already wearing a number keep it, in the order they joined; then the rest are given theirs.
  const missing: number[] = [];
  for (const p of club.players) {
    const n = numbers[p];
    if (n !== undefined && !taken.has(n)) {
      out.set(p, n);
      taken.add(n);
    } else {
      missing.push(p);
    }
  }
  for (const p of missing) {
    let n = wanted(world, p);
    for (let i = 0; i < MAX_NUMBER && taken.has(n); i++) n = (n % MAX_NUMBER) + 1;
    numbers[p] = n;
    out.set(p, n);
    taken.add(n);
  }
  return out;
}

/** A player's number at his club — null for a free agent. */
export function shirtNumberOf(world: World, p: number): number | null {
  const club = world.clubs[world.players.clubId[p]];
  if (club === undefined) return null;
  return clubNumbers(world, club).get(p) ?? null;
}

/** Give one of the club's players a number. A team-mate wearing it takes his old one in exchange. */
export function setShirtNumber(world: World, club: Club, p: number, n: number): { ok: boolean; text: string } {
  const store = world.players;
  if (!club.players.includes(p)) return { ok: false, text: `${store.fullName(p)} is not one of your players.` };
  if (!Number.isInteger(n) || n < MIN_NUMBER || n > MAX_NUMBER) return { ok: false, text: `Shirt numbers run from ${MIN_NUMBER} to ${MAX_NUMBER}.` };
  const current = clubNumbers(world, club);
  const old = current.get(p)!;
  if (old === n) return { ok: true, text: `${store.fullName(p)} already wears ${n}.` };
  const holder = [...current].find(([q, m]) => q !== p && m === n)?.[0];
  const numbers = world.shirtNumbers!;
  numbers[p] = n;
  if (holder !== undefined) {
    numbers[holder] = old;
    return { ok: true, text: `${store.fullName(p)} takes number ${n}; ${store.fullName(holder)} wears ${old} now.` };
  }
  return { ok: true, text: `${store.fullName(p)} wears number ${n}.` };
}
