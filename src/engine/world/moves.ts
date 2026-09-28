/**
 * Deals done while the transfer window is shut.
 *
 * Talks never close: a transfer or a loan can be agreed on any day of the
 * year. But a player under contract only changes clubs while a window is
 * open, so a deal agreed outside one is settled on paper — the fee paid, his
 * terms fixed — and he moves on the day the next window opens. Until then he
 * stays, and plays, where he is.
 */

import { DAYS_PER_SEASON, nextTransferWindow, transferWindowOn, type World } from './world.ts';

export interface PendingMove {
  kind: 'transfer' | 'loan';
  playerIdx: number;
  /** The club he is at now: the one selling or lending him. */
  fromClubId: number;
  /** The club he is going to. */
  toClubId: number;
  /** Absolute day he moves: the day the next window opens. */
  movesOn: number;
  /** Transfers: the fee, already paid when the deal was done. */
  fee: number;
  /** Transfers: his new wage. Loans: his wage, of which the borrower pays `wageShare`. */
  wage: number;
  /** Transfers: the day his new contract runs to. */
  contractEnd: number;
  /** Loans: the share of his wage the borrowing club pays. */
  wageShare: number;
}

/** The day a deal agreed today is completed: today, while a window is open;
 *  otherwise the day the next one opens. */
export function moveDay(world: World): number {
  return transferWindowOn(world.day) !== null ? world.day : nextTransferWindow(world.day).day;
}

/** The season a day falls in. */
export function seasonOfDay(day: number): number {
  return Math.floor(day / DAYS_PER_SEASON);
}

/** "1 January 2027" — the opening day of a window, as the inbox writes it. */
export function windowOpeningLabel(world: Pick<World, 'startYear'>, day: number): string {
  const season = seasonOfDay(day);
  // The summer window opens on 1 July, the first day of a season; the
  // winter one on 1 January, halfway through it.
  return day % DAYS_PER_SEASON < 184
    ? `1 July ${world.startYear + season}`
    : `1 January ${world.startYear + season + 1}`;
}

/** The deal a player has agreed and is waiting on the window for, if any. */
export function pendingMoveOf(world: World, playerIdx: number): PendingMove | undefined {
  return world.pendingMoves.find((m) => m.playerIdx === playerIdx);
}

/** Players who have agreed to join a club and are waiting on the window. */
export function arrivalsFor(world: World, clubId: number): PendingMove[] {
  return world.pendingMoves.filter((m) => m.toClubId === clubId);
}

/** What a club has promised in wages to players who have agreed to join but not yet arrived. */
export function pendingWages(world: World, clubId: number): number {
  let total = 0;
  for (const m of world.pendingMoves) {
    if (m.toClubId === clubId) total += m.kind === 'loan' ? m.wage * m.wageShare : m.wage;
  }
  return total;
}
