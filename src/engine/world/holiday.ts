/**
 * Going on holiday: the manager steps away and time runs on without him, day
 * after day, until the date he set, a number of days, or indefinitely —
 * until something needs him. His assistant keeps the club going meanwhile,
 * by the instructions left behind: what to do with bids for the players,
 * whether to apply for head coach jobs that come up, and whether matches are
 * played with the manager's own tactics and team or the assistant's.
 *
 * This module holds those instructions and what the assistant does with them
 * each day; running the days themselves is the game's.
 */

import { PlayerFlag } from '../model/players.ts';
import { applicationBlock, applyForJob } from './career.ts';
import { acceptIncomingOffer } from './deals.ts';
import type { World } from './world.ts';

/** Bids for the manager's players: take them all, take those at the player's value, or turn them down. */
export type OfferPolicy = 'acceptAll' | 'acceptValue' | 'reject';

/** Which vacant head coach jobs to apply for. */
export type JobTarget = 'any' | 'bigger' | 'topDivision' | 'home';

export const JOB_TARGETS: ReadonlyArray<readonly [JobTarget, string]> = [
  ['any', 'Any club'],
  ['bigger', 'Bigger clubs than yours'],
  ['topDivision', 'Top-division clubs'],
  ['home', 'Clubs in your country'],
];

/** When the manager comes back. */
export type HolidayReturn =
  | { kind: 'date'; day: number }
  | { kind: 'days'; days: number }
  | { kind: 'indefinite' };

export interface HolidayPlan {
  until: HolidayReturn;
  /** Apply for vacant jobs while away — and which — or not at all. */
  jobs: JobTarget | null;
  offers: OfferPolicy;
  /** Only let players go who are on the transfer (or loan) list. */
  onlyListed: boolean;
  /** Play matches with the manager's own tactics, rather than the assistant's. */
  useTactics: boolean;
  /** Pick the manager's own starting six whenever they are fit, rather than the assistant's. */
  useSelection: boolean;
}

export const DEFAULT_HOLIDAY: HolidayPlan = {
  until: { kind: 'days', days: 7 },
  jobs: null,
  offers: 'reject',
  onlyListed: false,
  useTactics: true,
  useSelection: true,
};

/** The absolute day a plan brings the manager back, or null for indefinitely. */
export function returnDay(world: World, until: HolidayReturn): number | null {
  if (until.kind === 'date') return until.day;
  if (until.kind === 'days') return world.day + Math.max(1, Math.round(until.days));
  return null;
}

/**
 * Deal with every bid waiting on an answer, as instructed. Bids already in
 * motion — an asking price sent back, a fee agreed and the player deciding —
 * are seen through as they are.
 */
export function answerOffers(world: World, policy: OfferPolicy, onlyListed: boolean): { accepted: number; declined: number } {
  const store = world.players;
  let accepted = 0;
  let declined = 0;
  for (const offer of [...world.incomingOffers]) {
    if ((offer.status ?? 'open') !== 'open') continue;
    const loan = offer.loan !== undefined;
    const listed = store.hasFlag(offer.playerIdx, loan ? PlayerFlag.LoanListed : PlayerFlag.Transferable);
    const worth = loan ? listed : offer.fee >= store.value[offer.playerIdx];
    const take = policy === 'acceptAll' || (policy === 'acceptValue' && worth);
    if (take && (!onlyListed || listed)) {
      acceptIncomingOffer(world, offer);
      accepted++;
    } else {
      world.incomingOffers = world.incomingOffers.filter((o) => o !== offer);
      declined++;
    }
  }
  return { accepted, declined };
}

/** Apply for every open head coach's job that fits, once each. Returns how many went out. */
export function applyForJobs(world: World, target: JobTarget): number {
  const own = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  let sent = 0;
  for (const v of world.vacancies) {
    const club = world.clubs[v.clubId];
    if (club === undefined || applicationBlock(world, v.clubId) !== null) continue;
    const fits = target === 'any'
      || (target === 'bigger' && club.reputation > (own?.reputation ?? 0))
      || (target === 'topDivision' && club.tier === 1)
      || (target === 'home' && own !== undefined && club.nation === own.nation);
    if (fits && applyForJob(world, v.clubId) !== null) sent++;
  }
  return sent;
}

/** Days of holiday the manager has taken this season. */
export function holidayDays(world: World): number {
  const h = world.career.holiday;
  return h !== undefined && h.season === world.season ? h.days : 0;
}

/** One more day away. */
export function countHolidayDay(world: World): void {
  world.career.holiday = { season: world.season, days: holidayDays(world) + 1 };
}
