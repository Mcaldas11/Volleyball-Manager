/**
 * Affiliate clubs: smaller clubs that work with the manager's.
 *
 * Up to two, from lower divisions or abroad, each agreeing to it if the
 * manager's club is the bigger name by enough. An affiliate takes the club's
 * young players on loan and plays them — no haggling, regular games promised
 * — and lets its own best young players go to the club cheaply, a quarter off
 * what it would ask anyone else. The club pays each a fee every season for it.
 */

import type { Club } from '../model/club.ts';
import { MAX_SQUAD } from '../model/positions.ts';
import { postMessage } from './inbox.ts';
import { euros, type World } from './world.ts';

export const MAX_AFFILIATES = 2;
/** What an affiliate lets its players go to the parent for, of what it would ask anyone else. */
export const AFFILIATE_DISCOUNT = 0.75;
/** Days a club takes to answer a proposal. */
const ANSWER_DAYS = [3, 6] as const;

export function affiliatesOf(world: World, club: Club): Club[] {
  return (club.affiliates ?? []).map((id) => world.clubs[id]).filter((c): c is Club => c !== undefined);
}

export function isAffiliate(club: Club, other: number): boolean {
  return club.affiliates?.includes(other) === true;
}

/** What an affiliation costs a season. */
export function affiliateFee(club: Club): number {
  return Math.round(Math.max(10_000, club.finances.wageBudget * 0.015) / 1000) * 1000;
}

/** Clubs that might become affiliates: much smaller names — at home a division or more down first, then abroad — best first. */
export function affiliateCandidates(world: World, club: Club): Club[] {
  const home = (c: Club): number => (c.nation === club.nation ? 0 : 1);
  return world.clubs
    .filter((c) => c.id !== club.id && c.players.length > 0 && !isAffiliate(club, c.id) &&
      c.reputation < club.reputation * 0.7 && (c.nation !== club.nation || c.tier > club.tier))
    .sort((a, b) => home(a) - home(b) || b.reputation - a.reputation)
    .slice(0, 40);
}

/** Why the club can't propose to this one, or null if it can. */
export function proposalBlock(world: World, club: Club, target: Club): string | null {
  if ((club.affiliates?.length ?? 0) >= MAX_AFFILIATES) return `You have ${MAX_AFFILIATES} affiliates already.`;
  if (isAffiliate(club, target.id)) return 'They are already your affiliate.';
  if ((world.affiliateTalks ?? []).some((t) => t.clubId === target.id)) return 'They are considering your proposal.';
  if (target.reputation >= club.reputation * 0.7) return `${target.name} are too big a club to be anyone's affiliate.`;
  return null;
}

/** Put the proposal to them. They answer in a few days. */
export function proposeAffiliation(world: World, club: Club, target: Club): string {
  const block = proposalBlock(world, club, target);
  if (block !== null) return block;
  (world.affiliateTalks ??= []).push({ clubId: target.id, resolvesOn: world.day + world.rng.int(ANSWER_DAYS[0], ANSWER_DAYS[1]) });
  return `Your proposal is with ${target.name} — they will answer within the week.`;
}

/** End an affiliation. */
export function endAffiliation(club: Club, other: number): void {
  club.affiliates = (club.affiliates ?? []).filter((id) => id !== other);
}

/** Each day: answers to proposals that are due. */
export function affiliatesDay(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const talks = world.affiliateTalks ?? [];
  if (talks.length === 0) return;
  for (const t of [...talks]) {
    if (t.resolvesOn > world.day) continue;
    world.affiliateTalks = (world.affiliateTalks ?? []).filter((x) => x !== t);
    const target = world.clubs[t.clubId];
    if (club === undefined || target === undefined) continue;
    const gap = club.reputation / Math.max(1, target.reputation);
    const yes = (club.affiliates?.length ?? 0) < MAX_AFFILIATES && world.rng.chance(Math.min(0.95, (gap - 1.1) * 1.5));
    if (yes) (club.affiliates ??= []).push(target.id);
    postMessage(world, {
      category: 'board', from: target.name, clubId: target.id,
      subject: yes ? `${target.name} become an affiliate` : `${target.name} say no`,
      body: yes
        ? `${target.name} have agreed to become an affiliate: they will take your young players on loan and play them, and let their own best young players come to you for a quarter less. It costs ${euros(affiliateFee(club))} a season.`
        : `${target.name} have thanked you for the offer, but would rather keep their independence.`,
    });
  }
}

/** Why one of the club's players can't go to an affiliate on loan, or null if he can. */
export function affiliateLoanBlock(affiliate: Club): string | null {
  if (affiliate.players.length >= MAX_SQUAD) return `${affiliate.name}'s squad is full.`;
  return null;
}

/** An affiliate's best young players — the ones the club might want, cheaply. */
export function affiliateProspects(world: World, affiliate: Club): number[] {
  const store = world.players;
  return affiliate.players
    .filter((p) => store.ageOn(p, world.year, 181) <= 21)
    .sort((a, b) => store.potentialAbility[b] - store.potentialAbility[a])
    .slice(0, 4);
}
