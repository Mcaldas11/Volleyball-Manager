/**
 * The club's commercial side: what it charges at the door, and who pays to
 * have their name on the shirt.
 *
 * Ticket prices are the manager's to set. Cheaper tickets fill the arena,
 * dearer ones take more from fewer people; the arena's capacity caps the
 * crowd either way, so a club that sells out can afford to charge more.
 *
 * Each summer the club's sponsors make offers for the season to come — a
 * steady fee; a smaller one with bonuses for a title or a top-three finish;
 * or a three-season deal, a little less a year but certain — and the manager
 * picks one. Leave it, and the commercial department signs the steady one.
 */

import { fanFactor } from './supporters.ts';
import type { Club } from '../model/club.ts';
import { sponsorshipFor } from '../model/club.ts';
import { postMessage } from './inbox.ts';
import { euros, type World } from './world.ts';

// ---- Tickets ------------------------------------------------------------------------------

export const TICKET_PRICES: ReadonlyArray<readonly [number, string]> = [
  [0.7, 'Cheap'], [0.85, 'Low'], [1, 'Normal'], [1.2, 'High'], [1.4, 'Premium'],
];

/** How strongly the crowd answers the price: a cheaper ticket brings more of them. */
const PRICE_ELASTICITY = 0.8;

export function ticketPriceOf(club: Club): number {
  return club.ticketPrice ?? 1;
}

/** How many come to a match at a price, given how many would at the normal one. */
export function crowdAt(normalCrowd: number, price: number): number {
  return Math.round(normalCrowd * Math.pow(price, -PRICE_ELASTICITY));
}

/** A home match's crowd and takings at a price, on an average night in the club's league. */
export function projectedGate(world: World, club: Club, price = ticketPriceOf(club)): { crowd: number; gate: number } {
  const comp = world.competitions[club.leagueId];
  const draw = comp !== undefined ? Math.min(1, comp.reputation / 8000) : 0.5;
  const normal = club.arenaCapacity * (0.42 + 0.5 * draw) * 0.93 * fanFactor(club);
  const crowd = Math.min(club.arenaCapacity, crowdAt(normal, price));
  const perHead = club.finances.ticketIncomePerMatch / Math.max(1, club.arenaCapacity);
  return { crowd, gate: Math.round(crowd * perHead * price) };
}

export function setTicketPrice(club: Club, price: number): void {
  club.ticketPrice = price;
}

// ---- Sponsors -----------------------------------------------------------------------------

export type SponsorKind = 'steady' | 'bonus' | 'long';

export interface SponsorOffer {
  name: string;
  kind: SponsorKind;
  /** A season. */
  base: number;
  titleBonus: number;
  podiumBonus: number;
  seasons: number;
}

/** The deal the club has signed. */
export interface SponsorDeal extends SponsorOffer {
  /** The last season it pays for. */
  untilSeason: number;
}

export const SPONSOR_KIND_NAMES: Readonly<Record<SponsorKind, string>> = {
  steady: 'Steady deal', bonus: 'Performance deal', long: 'Long-term deal',
};

const BRANDS = [
  'Nordwave Energy', 'Atlas Insurance', 'Volta Motors', 'Kestrel Bank', 'Lumen Telecom', 'Orbis Airlines', 'Helix Pharma',
  'Corvid Logistics', 'Solara Foods', 'Meridian Hotels', 'Pinnacle Steel', 'Aurora Water', 'Tessera Tech', 'Halcyon Sports',
];

/** Days the manager has to choose before the steady deal is signed for him. */
const CHOOSE_DAYS = 30;

/** This summer's offers for the club. */
export function sponsorOffers(world: World, club: Club): SponsorOffer[] {
  const s = sponsorshipFor(club.reputation);
  const pick = (k: number): string => BRANDS[(club.id * 7 + world.season * 3 + k) % BRANDS.length];
  const round = (x: number): number => Math.round(x / 1000) * 1000;
  return [
    { name: pick(0), kind: 'steady', base: round(s), titleBonus: 0, podiumBonus: 0, seasons: 1 },
    { name: pick(1), kind: 'bonus', base: round(s * 0.75), titleBonus: round(s * 0.6), podiumBonus: round(s * 0.25), seasons: 1 },
    { name: pick(2), kind: 'long', base: round(s * 0.93), titleBonus: 0, podiumBonus: 0, seasons: 3 },
  ];
}

/** Sign one of the summer's offers. */
export function chooseSponsor(world: World, club: Club, index: number): string {
  const open = world.sponsorOffers;
  if (open === undefined || open.season !== world.season || open.chosen !== undefined) return 'There is no offer to sign.';
  const offer = open.offers[index];
  if (offer === undefined) return 'There is no such offer.';
  open.chosen = index;
  club.sponsor = { ...offer, untilSeason: world.season + offer.seasons - 1 };
  club.finances.sponsorshipIncome = offer.base;
  return `${offer.name} are the club's sponsor: ${euros(offer.base)} a season${offer.seasons > 1 ? ` for ${offer.seasons} seasons` : ''}.`;
}

/** Whether the club's sponsor still pays this season. */
function dealRuns(world: World, club: Club): boolean {
  return club.sponsor !== undefined && club.sponsor.untilSeason >= world.season;
}

/**
 * Each day at the manager's club: with no deal for the season, the offers
 * come in; left too long, the commercial department signs the steady one.
 */
export function sponsorDay(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined || dealRuns(world, club)) return;
  const open = world.sponsorOffers;
  if (open === undefined || open.season !== world.season || open.clubId !== club.id) {
    const offers = sponsorOffers(world, club);
    world.sponsorOffers = { season: world.season, clubId: club.id, offers, day: world.day };
    postMessage(world, {
      category: 'finance', from: 'Commercial Department',
      subject: 'Sponsorship offers for the season',
      body: `Three companies want their name on the shirt this season: ${offers.map((o) => o.name).join(', ')}. ` +
        `Pick one on the Tickets & Sponsors screen — if you leave it ${CHOOSE_DAYS} days, we will sign the steady deal.`,
      sponsorOffers: true,
    });
    return;
  }
  if (open.chosen === undefined && world.day - open.day >= CHOOSE_DAYS) {
    const text = chooseSponsor(world, club, 0);
    postMessage(world, { category: 'finance', from: 'Commercial Department', subject: 'Sponsor signed', body: `We have signed the steady deal. ${text}` });
  }
}

/**
 * As the season ends: the sponsor's bonuses for where the club finished, and
 * the fee for next season — the deal's, if it runs on, or the going rate.
 * Called before the season's books are settled, then after.
 */
export function sponsorBonus(world: World, club: Club, finish: number): number {
  if (!dealRuns(world, club) || club.sponsor === undefined) return 0;
  const bonus = finish === 1 ? club.sponsor.titleBonus + club.sponsor.podiumBonus : finish <= 3 ? club.sponsor.podiumBonus : 0;
  if (bonus > 0) {
    club.finances.sponsorshipIncome += bonus;
    postMessage(world, {
      category: 'finance', from: club.sponsor.name,
      subject: 'Sponsor bonus',
      body: `${club.sponsor.name} pay a bonus of ${euros(bonus)} for finishing ${finish === 1 ? 'first' : `in the top three`}.`,
    });
  }
  return bonus;
}

/** Next season's fee: the deal's, if it runs on; otherwise the going rate, until a new one is signed. */
export function nextSeasonSponsorship(world: World, club: Club): number {
  if (club.sponsor !== undefined && club.sponsor.untilSeason >= world.season + 1) return club.sponsor.base;
  club.sponsor = undefined;
  return sponsorshipFor(club.reputation);
}
