/**
 * An under-21 side's contracts go by age: a player signs until the end of the
 * last season he is under-21 for (born no earlier than twenty years before the
 * season starts). A sixteen-year-old is signed for five seasons; a twenty-year-old
 * for this one.
 *
 * When that season ends he is too old for the side, and the senior club
 * decides: a first-team contract, or he goes on a free.
 * - A senior club the manager runs: he is warned in January and again in May,
 *   and either opens contract talks (the usual renewal negotiation) or lets the
 *   player go. Not renewed by 30 June, the player leaves.
 * - Any other senior club keeps the ones good enough for it, now or to come,
 *   and lets the rest go.
 * The under-21 side's coach has no say: if that is the manager, he is told what
 * the senior club decided. Players the senior club has sent down to the side
 * keep their own senior contracts, which are left alone.
 */

import { Rng } from '../core/rng.ts';
import { postMessage } from './inbox.ts';
import { under21Relations } from './under21.ts';
import { contractEndSeason, logTransfer, seasonEndDay, type World } from './world.ts';
import type { Club } from '../model/club.ts';

/** The days of the season the senior manager is warned: 1 January and 1 May, as for his own contracts. */
const WARNING_DAYS: readonly number[] = [184, 304];

/** The last season a player is under-21 for. */
export function lastUnder21Season(world: World, p: number): number {
  return world.players.birthYear[p] + 20 - world.startYear;
}

/** The day an under-21 contract runs to: the end of his last under-21 season — or this one's, if that has passed. */
export function under21ContractEnd(world: World, p: number, from = world.season): number {
  return seasonEndDay(Math.max(from, lastUnder21Season(world, p)));
}

/** Whether this is a player's last season as an under-21. */
export function agingOut(world: World, p: number): boolean {
  return lastUnder21Season(world, p) <= world.season;
}

/**
 * Every under-21 side's players on contracts that run to their age limit — once, for a new world or
 * a save from before this: the side's own players, not those the senior club sent down.
 */
export function alignUnder21Contracts(world: World): void {
  const R = under21Relations(world);
  if (R.contractsByAge === true) return;
  R.contractsByAge = true;
  for (const club of world.clubs) {
    if (club.under21Of === undefined) continue;
    for (const p of club.players) world.players.contractUntil[p] = under21ContractEnd(world, p);
  }
}

/** The senior club whose decision a side's player is, and the side — if he plays for an under-21 side. */
function sides(world: World, p: number): { side: Club; senior: Club } | null {
  const side = world.clubs[world.players.clubId[p]];
  if (side === undefined || side.under21Of === undefined) return null;
  const senior = world.clubs[side.under21Of];
  return senior !== undefined ? { side, senior } : null;
}

/** Whether a player at an under-21 side is the manager's to renew: his last season there, and the manager runs the senior club. */
export function under21RenewalIsMine(world: World, p: number): boolean {
  const s = sides(world, p);
  return s !== null && s.senior.id === world.userClubId && agingOut(world, p) &&
    contractEndSeason(world.players.contractUntil[p]) <= world.season;
}

/** The under-21 side's players whose contract ends with this season, for the senior club to decide on. */
export function agingOutOf(world: World, side: Club): number[] {
  return side.players.filter((p) => agingOut(world, p) && contractEndSeason(world.players.contractUntil[p]) <= world.season);
}

/** Whether the manager has said he will let a player go. */
export function releasedByManager(world: World, p: number): boolean {
  return world.under21?.letGo?.includes(p) === true;
}

/** The senior manager lets an under-21 player's contract run out. */
export function letUnder21PlayerGo(world: World, p: number): { ok: boolean; text: string } {
  const name = world.players.fullName(p);
  if (!under21RenewalIsMine(world, p)) return { ok: false, text: `${name}'s contract is not yours to decide on.` };
  const R = under21Relations(world);
  if (!(R.letGo ??= []).includes(p)) R.letGo.push(p);
  return { ok: true, text: `${name} will leave when his under-21 contract runs out on 30 June.` };
}

/**
 * How a senior club rates its under-21s at the age limit: kept if he is nearly good enough for its
 * squad already, or will be. The squad's level is the average of its best twelve.
 */
export function seniorKeeps(world: World, senior: Club, p: number): boolean {
  const store = world.players;
  const best = senior.players.map((x) => store.currentAbility[x]).sort((a, b) => b - a).slice(0, 12);
  const level = best.length > 0 ? best.reduce((s, x) => s + x, 0) / best.length : 0;
  return store.currentAbility[p] >= level * 0.85 || store.potentialAbility[p] >= level * 1.02;
}

/** The senior manager's warnings: on 1 January and 1 May, each player at his under-21 side whose contract ends with his under-21 days. */
export function under21ContractsDay(world: World): void {
  alignUnder21Contracts(world);
  const d = world.day % 365;
  if (!WARNING_DAYS.includes(d) || world.userClubId < 0) return;
  const senior = world.clubs[world.userClubId];
  const side = senior !== undefined ? world.clubs.find((c) => c.under21Of === senior.id) : undefined;
  if (side === undefined) return;
  const store = world.players;
  for (const p of agingOutOf(world, side)) {
    if (releasedByManager(world, p)) continue;
    postMessage(world, {
      subject: d === WARNING_DAYS[0] ? `Under-21 contract ending: ${store.fullName(p)}` : `Two months left: ${store.fullName(p)}`,
      body: `${store.fullName(p)} turns too old for ${side.name} at the end of the season, and his under-21 contract runs out on 30 June. ` +
        `The decision is the first team's: offer him a senior contract, or let him go on a free.`,
      playerIdx: p,
      category: 'contract',
      under21Contract: true,
    });
  }
}

/**
 * The season closing: each under-21 side's players at the end of their contracts. One still under-21
 * next season stays, his contract running on to his age limit. One too old: kept on a first-team
 * contract if the senior club wants him (the manager's club: if he renewed him), released if not.
 * Returns the released, for the free list.
 */
export function settleUnder21Contracts(world: World): number[] {
  const store = world.players;
  const lastDay = seasonEndDay(world.season);
  const rng = new Rng(`u21c:${world.seed}:${world.season}`);
  const released: number[] = [];
  for (const side of world.clubs) {
    if (side.under21Of === undefined) continue;
    const senior = world.clubs[side.under21Of];
    const kept: number[] = [];
    const gone: number[] = [];
    for (const p of [...side.players]) {
      if (store.contractUntil[p] > lastDay) continue;
      if (!agingOut(world, p)) {
        store.contractUntil[p] = under21ContractEnd(world, p, world.season + 1);
        continue;
      }
      // Too old for the side: the senior club's call. The manager's own club decided by renewing him, or not.
      const keep = senior !== undefined && senior.id !== world.userClubId && seniorKeeps(world, senior, p);
      if (keep) {
        store.contractUntil[p] = seasonEndDay(world.season + rng.int(2, 3));
        store.wage[p] = Math.round((store.wage[p] * 1.5) / 1000) * 1000;
        kept.push(p);
        continue;
      }
      side.players = side.players.filter((x) => x !== p);
      side.preferredLineup = side.preferredLineup.filter((x) => x !== p);
      if (side.preferredLibero === p) side.preferredLibero = -1;
      logTransfer(world, p, side.id, -1, 0);
      store.clubId[p] = -1;
      gone.push(p);
      released.push(p);
    }
    notify(world, side, senior, kept, gone);
  }
  const R = world.under21;
  if (R !== undefined) R.letGo = [];
  return released;
}

/** The manager hears what became of his side's players at the age limit: as its coach, or as the senior club's manager. */
function notify(world: World, side: Club, senior: Club | undefined, kept: number[], gone: number[]): void {
  if (kept.length + gone.length === 0 || senior === undefined) return;
  const store = world.players;
  const list = (ps: number[]): string => ps.map((p) => store.fullName(p)).join(', ');
  if (world.userClubId === side.id) {
    postMessage(world, {
      subject: `${senior.name} decide on the players leaving ${side.name}`,
      body: [
        kept.length > 0 ? `${senior.name} have offered first-team contracts to ${list(kept)}.` : '',
        gone.length > 0 ? `${list(gone)} ${gone.length === 1 ? 'has' : 'have'} been released: too old for the under-21s, and not wanted by the first team.` : '',
      ].filter((x) => x !== '').join(' '),
      from: senior.name,
      category: 'contract',
    });
  } else if (world.userClubId === senior.id && gone.length > 0) {
    postMessage(world, {
      subject: gone.length === 1 ? `${store.fullName(gone[0])} leaves ${side.name}` : `${gone.length} players leave ${side.name}`,
      body: `${list(gone)} ${gone.length === 1 ? 'was' : 'were'} not given a first-team contract and ${gone.length === 1 ? 'leaves' : 'leave'} on a free transfer.`,
      category: 'contract',
    });
  }
}
