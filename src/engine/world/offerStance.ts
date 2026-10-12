/**
 * How a player takes another club's bid for him.
 *
 * Some want the move: a bigger club, more money, the games they aren't
 * getting here. Some are happy where they are — settled, loyal, playing,
 * liked — and would rather stay. Most could go either way. It is fixed the
 * moment the bid arrives, and it shows on the offer, so the manager knows
 * what he is deciding.
 *
 * It matters afterwards. Turn down a bid a player wanted, or let it lapse,
 * and he takes it badly: his morale drops, and he may ask to leave there and
 * then. Turn down one he didn't want, and he is glad the club values him.
 * Agree to sell one who wanted to stay, and he will most likely refuse to go
 * — and resent being shown the door; one who wanted to go agrees terms.
 */

import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import type { IncomingOffer } from './negotiation.ts';
import { postMessage } from './inbox.ts';
import { seasonsAtClub } from './dressingRoom.ts';
import type { World } from './world.ts';

export type OfferStance = 'keen' | 'open' | 'staying';

/** How each reads on the offer. */
export const STANCE_NAMES: Readonly<Record<OfferStance, string>> = {
  keen: 'Wants the move',
  open: 'Could go either way',
  staying: 'Wants to stay',
};

/** The line on the bid's message. */
export function stanceLine(world: World, offer: IncomingOffer): string {
  const name = world.players.fullName(offer.playerIdx);
  const buyer = world.clubs[offer.buyingClubId]?.name ?? 'them';
  switch (stanceOf(world, offer)) {
    case 'keen': return `${name} knows about it, and wants to go to ${buyer} — turn it down and he won't take it well.`;
    case 'staying': return `${name} is happy here and would rather stay — he may well refuse to go even if you accept.`;
    default: return `${name} could go either way.`;
  }
}

/** A number in [0, 1) fixed by two keys, for what must not shift the world's own dice. */
export function hash01(a: number, b: number): number {
  let h = (Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How hard he pulls towards the move: above 0.22 he wants it, below -0.18 he would rather stay. */
export function movePull(world: World, buyer: Club, p: number): number {
  const store = world.players;
  const clubId = store.clubId[p];
  const club = world.clubs[clubId];
  const attr = (k: Parameters<typeof store.getAttr>[1]): number => (store.getAttr(p, k) - 10) / 10;
  const step = (buyer.reputation - (club?.reputation ?? buyer.reputation)) / 10000;
  const ambition = attr('ambition');
  const loyalty = attr('loyalty');
  const morale = (store.morale[p] - 55) / 45;
  const playing = (store.playingTime[p] - 50) / 50;
  const tenure = club !== undefined ? Math.min(6, seasonsAtClub(world, p, club.id)) / 6 : 0;
  const age = store.ageOn(p, world.year, 181);
  // Already asked to go, or listed: he is ready to.
  const unsettled = world.transferRequests?.[p] !== undefined || store.hasFlag(p, PlayerFlag.Transferable) ? 0.35 : 0;
  return 1.6 * step * (1 + 0.6 * ambition) - 0.32 * morale - 0.28 * playing - 0.22 * loyalty - 0.22 * tenure +
    (age <= 24 ? 0.08 : age >= 31 ? -0.1 : 0) + unsettled + (hash01(p, buyer.id) - 0.5) * 0.2;
}

/** The player's stance on a bid — worked out once, when it is first asked for, and kept. */
export function stanceOf(world: World, offer: IncomingOffer): OfferStance {
  if (offer.stance !== undefined) return offer.stance;
  const buyer = world.clubs[offer.buyingClubId];
  const pull = buyer !== undefined ? movePull(world, buyer, offer.playerIdx) : 0;
  offer.stance = pull > 0.22 ? 'keen' : pull < -0.18 ? 'staying' : 'open';
  offer.pull = pull;
  return offer.stance;
}

/**
 * A bid gone without a sale — turned down, or left to lapse. A player who
 * wanted it is hurt, and may ask to leave; one who wanted to stay is glad.
 * Only the last bid standing for him counts: while another is on the table,
 * the move isn't off.
 */
export function bidTurnedDown(world: World, offer: IncomingOffer, how: 'declined' | 'lapsed'): void {
  if (offer.loan !== undefined) return;
  const store = world.players;
  const p = offer.playerIdx;
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined || !club.players.includes(p)) return;
  if (world.incomingOffers.some((o) => o.id !== offer.id && o.playerIdx === p && o.loan === undefined)) return;
  const stance = stanceOf(world, offer);
  const name = store.fullName(p);
  const buyer = world.clubs[offer.buyingClubId]?.name ?? 'the club';
  if (stance === 'staying' && how === 'declined') {
    store.morale[p] = Math.min(100, store.morale[p] + 3);
    postMessage(world, {
      category: 'contract', from: name, playerIdx: p,
      subject: `${name} is glad to stay`,
      body: `${name} heard you turned down ${buyer}. He is pleased the club wants to keep him — he never wanted to go.`,
    });
    return;
  }
  if (stance !== 'keen') return;
  const pull = Math.min(1, Math.max(0, offer.pull ?? 0.3));
  store.morale[p] = Math.max(0, store.morale[p] - Math.round(6 + 10 * pull));
  const asked = world.transferRequests?.[p];
  const already = asked !== undefined && (asked.status === 'open' || asked.status === 'listed');
  const temper = (store.getAttr(p, 'temperament') - 10) / 10;
  const chance = Math.min(0.85, Math.max(0.15, 0.25 + pull * 0.8 + (store.getAttr(p, 'ambition') - 10) * 0.03 - temper * 0.15));
  const what = how === 'declined' ? `you turned down ${buyer}` : `${buyer}'s offer was left to lapse`;
  if (!already && !store.hasFlag(p, PlayerFlag.Transferable) && hash01(p, offer.id * 7 + 3) < chance) {
    (world.transferRequests ??= {})[p] = { day: world.day, status: 'open', reason: 'blockedMove' };
    postMessage(world, {
      category: 'contract', from: name, playerIdx: p, transferRequestOf: p,
      subject: `${name} asks to leave`,
      body: `${name} is furious that ${what}. He wanted that move, and has handed in a transfer request. ` +
        'You can let him go, promise him what he wants, or tell him he is staying.',
    });
    return;
  }
  // Not yet a request — but he is unsettled, and a few weeks of it will bring one.
  const weeks = (world.unhappyWeeks ??= {});
  weeks[p] = Math.max(weeks[p] ?? 0, 2);
  postMessage(world, {
    category: 'contract', from: name, playerIdx: p,
    subject: `${name} is unhappy`,
    body: `${name} is disappointed that ${what} — he wanted to go. He has accepted it for now, but he is unsettled. ` +
      'A word with him might help.',
  });
}

/**
 * The player's answer once the clubs have agreed a fee, against how he felt
 * about the move: one who wanted it agrees; one who wanted to stay most
 * likely refuses — and feels the club tried to get rid of him.
 */
export function stanceOnAgreedSale(world: World, offer: IncomingOffer, agreed: boolean): boolean {
  const stance = stanceOf(world, offer);
  const store = world.players;
  const p = offer.playerIdx;
  if (stance === 'keen') return true;
  if (stance === 'staying') {
    const goes = agreed && hash01(p, offer.id * 13 + 5) < 0.15;
    if (!goes) store.morale[p] = Math.max(0, store.morale[p] - 6);
    return goes;
  }
  return agreed;
}
