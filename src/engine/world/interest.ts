/**
 * Which clubs are interested in a player, as his profile tells it: the ones
 * that have bid for him or asked to borrow him, the ones the papers say are
 * after him — and the ones keeping an eye on him, clubs his level would suit,
 * that need someone at his position and could pay him.
 *
 * A player about to retire interests nobody.
 */

import { Position, SQUAD_TARGET } from '../model/positions.ts';
import { willRetire } from './retirement.ts';
import { wageRoom } from './loans.ts';
import type { World } from './world.ts';

export interface ClubInterest {
  clubId: number;
  /** Bid for him, asked to borrow him, rumoured after him, or keeping tabs. */
  why: 'bid' | 'loan' | 'rumour' | 'watching';
  /** The bid, when there is one. */
  fee?: number;
}

/** How many clubs keeping tabs a profile names, at most. */
const WATCHERS = 3;

export function interestedClubs(world: World, p: number): ClubInterest[] {
  const store = world.players;
  const own = store.clubId[p];
  const out: ClubInterest[] = [];
  const seen = new Set<number>();
  const add = (i: ClubInterest): void => {
    if (i.clubId === own || seen.has(i.clubId) || world.clubs[i.clubId] === undefined) return;
    seen.add(i.clubId);
    out.push(i);
  };
  for (const o of world.incomingOffers) {
    if (o.playerIdx === p && o.expiresOnDay >= world.day) add({ clubId: o.buyingClubId, why: o.loan !== undefined ? 'loan' : 'bid', fee: o.loan !== undefined ? undefined : o.fee });
  }
  if (willRetire(world, p) || !store.isActive(p)) return out;
  for (const n of world.news) {
    if (n.kind === 'rumour' && n.playerIdx === p && n.day > world.day - 120 && n.clubId !== undefined) add({ clubId: n.clubId, why: 'rumour' });
  }

  // Keeping tabs: a club his level suits, short at his position or weaker there than him, that could pay him.
  const pos = store.position[p] as Position;
  const level = store.currentAbility[p] / 2000;
  const watchers: Array<{ clubId: number; fit: number }> = [];
  for (const c of world.clubs) {
    if (c.id === own || seen.has(c.id) || c.players.length === 0 || c.id === world.userClubId) continue;
    const standing = c.reputation / 10_000;
    if (standing < level - 0.12 || standing > level + 0.18) continue;
    const there = c.players.filter((x) => store.position[x] === pos);
    const best = there.reduce((m, x) => Math.max(m, store.currentAbility[x]), 0);
    if (there.length >= SQUAD_TARGET[pos] && best >= store.currentAbility[p]) continue;
    if (wageRoom(world, c) < store.wage[p] * 0.6) continue;
    watchers.push({ clubId: c.id, fit: Math.abs(standing - level - 0.03) - (best < store.currentAbility[p] ? 0.05 : 0) });
  }
  watchers.sort((a, b) => a.fit - b.fit || a.clubId - b.clubId);
  for (const w of watchers.slice(0, WATCHERS)) add({ clubId: w.clubId, why: 'watching' });
  return out;
}
