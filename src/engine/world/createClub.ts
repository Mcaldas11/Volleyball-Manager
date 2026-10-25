/**
 * Create a club, and draft its squad. The manager's own club takes the place of the weakest in a
 * league of his choosing: his name for it, his colours. Its squad can be the one it had — or the whole
 * league's players can go into a fantasy draft, every club picking in turn, snaking back each round,
 * the manager picking his own as his turn comes round and the other clubs each taking the best man
 * left for the position they need most. Whoever is left over is a free agent.
 */

import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { seasonEndDay, type World } from './world.ts';

export interface NewClub {
  name: string;
  shortName: string;
  shirt: string;
  shorts: string;
  compId: number;
}

/** The club a new one takes the place of in a league: its weakest. */
export function clubToReplace(world: World, compId: number): number | undefined {
  const league = world.competitions[compId];
  return league === undefined || league.participants.length === 0
    ? undefined
    : [...league.participants].sort((a, b) => world.clubs[a].reputation - world.clubs[b].reputation)[0];
}

/** "#rrggbb" → its hue, 0-360. */
function hueOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

/** Make the manager's club: the league's weakest renamed and recoloured. Its id, or undefined. */
export function createClub(world: World, spec: NewClub): number | undefined {
  const id = clubToReplace(world, spec.compId);
  const club = id !== undefined ? world.clubs[id] : undefined;
  if (club === undefined) return undefined;
  club.name = spec.name.trim();
  club.shortName = spec.shortName.trim().toUpperCase().slice(0, 4);
  // The libero's shirt: the shorts' colour, or gold should that be the shirt's.
  club.kit = { hue: hueOf(spec.shirt), shirt: spec.shirt, shorts: spec.shorts, libero: spec.shorts === spec.shirt ? '#d7a73f' : spec.shorts };
  return club.id;
}

// ---- The draft -------------------------------------------------------------------------------

export interface Draft {
  compId: number;
  /** The clubs, in the order they pick in the first round. */
  order: number[];
  rounds: number;
  /** Who picked whom, in order. */
  picks: Array<{ clubId: number; p: number }>;
  /** The players still to be picked. */
  pool: number[];
  done: boolean;
}

/** How many of each position a side wants, in the order it fills them. */
const WANT: ReadonlyArray<readonly [Position, number]> = [
  [Position.Setter, 2], [Position.Opposite, 2], [Position.OutsideHitter, 4], [Position.MiddleBlocker, 4], [Position.Libero, 2],
];

/** Every senior player in the league goes into the pool; the clubs pick in a random order. */
export function startDraft(world: World, compId: number): Draft | undefined {
  const league = world.competitions[compId];
  if (league === undefined) return undefined;
  const store = world.players;
  const pool: number[] = [];
  for (const id of league.participants) {
    const club = world.clubs[id];
    const seniors = club.players.filter((p) => !store.hasFlag(p, PlayerFlag.Youth));
    pool.push(...seniors);
    club.players = club.players.filter((p) => store.hasFlag(p, PlayerFlag.Youth));
    for (const p of seniors) store.clubId[p] = -1;
  }
  const order = [...league.participants];
  for (let i = order.length - 1; i > 0; i--) {
    const j = world.rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  pool.sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const draft: Draft = { compId, order, rounds: Math.min(14, Math.floor(pool.length / order.length)), picks: [], pool, done: false };
  world.draft = draft;
  return draft;
}

/** Whose pick it is — snaking: the order one round, reversed the next. Undefined once it is over. */
export function draftTurn(d: Draft): number | undefined {
  const n = d.picks.length;
  const total = d.rounds * d.order.length;
  if (n >= total) return undefined;
  const round = Math.floor(n / d.order.length);
  const at = n % d.order.length;
  return d.order[round % 2 === 0 ? at : d.order.length - 1 - at];
}

/** The pick number on — round and pick in it, from 1. */
export function draftPosition(d: Draft): { round: number; pick: number } {
  return { round: Math.floor(d.picks.length / d.order.length) + 1, pick: (d.picks.length % d.order.length) + 1 };
}

function assign(world: World, clubId: number, p: number): void {
  const d = world.draft!;
  const club = world.clubs[clubId];
  d.pool = d.pool.filter((x) => x !== p);
  d.picks.push({ clubId, p });
  club.players.push(p);
  world.players.clubId[p] = clubId;
  world.players.contractUntil[p] = Math.max(world.players.contractUntil[p], seasonEndDay(world.season + 1));
}

/** The position a club needs most now: the first it has fewest of, against what it wants. */
export function draftNeed(world: World, clubId: number): Position {
  const store = world.players;
  const club = world.clubs[clubId];
  let best = WANT[0][0];
  let gap = -Infinity;
  for (const [pos, want] of WANT) {
    const have = club.players.filter((p) => store.position[p] === pos && !store.hasFlag(p, PlayerFlag.Youth)).length;
    const g = (want - have) / want;
    if (g > gap) {
      gap = g;
      best = pos;
    }
  }
  return best;
}

/** A club the manager doesn't run takes its pick: the best man left at the position it needs most. */
function aiPick(world: World, clubId: number): void {
  const d = world.draft!;
  const store = world.players;
  const need = draftNeed(world, clubId);
  const p = d.pool.find((x) => store.position[x] === need) ?? d.pool[0];
  if (p !== undefined) assign(world, clubId, p);
}

/** The other clubs pick until it is the manager's turn — or the draft is over. */
export function runDraftToUser(world: World): void {
  const d = world.draft;
  if (d === undefined || d.done) return;
  for (let turn = draftTurn(d); turn !== undefined && turn !== world.userClubId && d.pool.length > 0; turn = draftTurn(d)) aiPick(world, turn);
  if (draftTurn(d) === undefined || d.pool.length === 0) finishDraft(world);
}

/** The manager's pick, then on to his next turn. */
export function draftPick(world: World, p: number): boolean {
  const d = world.draft;
  if (d === undefined || d.done || draftTurn(d) !== world.userClubId || !d.pool.includes(p)) return false;
  assign(world, world.userClubId, p);
  runDraftToUser(world);
  return true;
}

/** Let the assistant pick for the manager — the best man at the position he needs. */
export function draftAutoPick(world: World): void {
  const d = world.draft;
  if (d === undefined || d.done || draftTurn(d) !== world.userClubId) return;
  const store = world.players;
  const need = draftNeed(world, world.userClubId);
  const p = d.pool.find((x) => store.position[x] === need) ?? d.pool[0];
  if (p !== undefined) draftPick(world, p);
}

/** The draft over: whoever is left is a free agent. */
export function finishDraft(world: World): void {
  const d = world.draft;
  if (d === undefined) return;
  d.done = true;
  for (const p of d.pool) world.players.clubId[p] = -1;
  d.pool = [];
}
