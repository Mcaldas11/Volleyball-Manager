/**
 * A livelier market.
 *
 * The papers talk about the manager's own players: a bigger club keeping tabs
 * on one of his best, and an ambitious player's head turned by it. And the
 * last day of every window is deadline day: the manager hears of it that
 * morning, every club answers on the day, bids fly in, the other clubs do
 * their late business — and the papers round it all up that night.
 */

import { PlayerFlag } from '../model/players.ts';
import { MAX_SQUAD } from '../model/positions.ts';
import { postMessage } from './inbox.ts';
import { loanOf } from './loans.ts';
import { completeTransfer, generateIncomingOffers, generateListedBids } from './negotiation.ts';
import { pendingMoveOf, windowOpeningLabel } from './moves.ts';
import { followed, postNews } from './news.ts';
import { hash01 } from './offerStance.ts';
import { euros, nextTransferWindow, seasonEndDay, windowCloseDay, type World } from './world.ts';

/** Weekly chance the papers link one of the manager's best with a bigger club. */
const RUMOUR_CHANCE = 0.3;

/** The week's gossip about the manager's own players. Called weekly. */
export function rumoursAboutUs(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined || club.players.length === 0) return;
  if (hash01(world.day, club.id * 3 + 1) >= RUMOUR_CHANCE) return;
  const store = world.players;
  const best = club.players
    .filter((p) => loanOf(world, p) === undefined && pendingMoveOf(world, p) === undefined && !store.hasFlag(p, PlayerFlag.Youth))
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 5);
  if (best.length === 0) return;
  const p = best[Math.floor(hash01(world.day, club.id * 3 + 2) * best.length)];
  const recent = world.news.some((n) => n.kind === 'rumour' && n.playerIdx === p && n.day > world.day - 60);
  if (recent) return;
  const suitors = world.clubs.filter((c) => c.id !== club.id && c.tier === 1 && c.reputation > club.reputation + 300 && c.players.length > 0);
  if (suitors.length === 0) return;
  const suitor = suitors[Math.floor(hash01(world.day, club.id * 3 + 3) * suitors.length)];
  const name = store.fullName(p);
  const headlines = [
    `${suitor.name} keeping tabs on ${name}`,
    `${name} on ${suitor.name}'s radar`,
    `${suitor.name} eye ${club.name}'s ${name}`,
  ];
  postNews(world, {
    kind: 'rumour',
    headline: headlines[Math.floor(hash01(world.day, p) * headlines.length)],
    body: `${suitor.name} are said to be watching ${club.name}'s ${name} closely, with a view to a bid when the window opens.`,
    nation: club.nation,
    clubId: suitor.id,
    otherClubId: club.id,
    playerIdx: p,
    fans: { story: 'rumour', club: suitor.id, other: club.id, player: p },
  });
  // An ambitious player reads the papers too.
  if (store.getAttr(p, 'ambition') >= 14) {
    store.morale[p] = Math.max(0, store.morale[p] - 3);
    postMessage(world, {
      category: 'contract', from: 'Assistant Coach', playerIdx: p,
      subject: `${name}'s head turned?`,
      body: `${name} has seen the stories linking him with ${suitor.name}. He is an ambitious lad — he has been quieter than usual in training. ` +
        'A word might help, or a new contract.',
    });
  }
}

/** The morning of deadline day: the manager hears. Called as each day turns. */
export function deadlineMorning(world: World): void {
  if (windowCloseDay(world.day) !== world.day) return;
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return;
  const store = world.players;
  const talks = world.talks.filter((t) => t.kind !== 'renewal');
  const bids = world.incomingOffers.filter((o) => (o.status ?? 'open') === 'open');
  const next = nextTransferWindow(world.day + 1);
  const lines = [
    'It is deadline day: the window shuts tonight. Every club will give its answer today, and the phones will not stop.',
    talks.length > 0 ? `Still open: ${talks.map((t) => store.fullName(t.playerIdx)).join(', ')}.` : '',
    bids.length > 0 ? `Bids on the table for ${[...new Set(bids.map((o) => store.fullName(o.playerIdx)))].join(', ')}.` : '',
    `Anything for a player under contract not done by midnight waits until the window opens again on ${windowOpeningLabel(world, next.day)}.`,
  ].filter((l) => l !== '');
  postMessage(world, { category: 'news', from: 'Director of Football', subject: 'Deadline day', body: lines.join(' ') });
  // Everyone answers today.
  for (const t of world.talks) if (t.pending !== null && t.pending.resolvesOn > world.day) t.pending.resolvesOn = world.day;
  for (const o of world.incomingOffers) if (o.resolvesOn !== undefined && o.resolvesOn > world.day) o.resolvesOn = world.day;
}

/**
 * Deadline day itself: the bids fly in, the other clubs do their late business,
 * and the papers round it up. Called each day, before the deals are answered.
 */
export function deadlineDay(world: World): void {
  if (windowCloseDay(world.day) !== world.day) return;
  // More bids than any other day.
  generateIncomingOffers(world);
  generateListedBids(world);
  // The other clubs' late deals: a fringe player from a full squad to a bigger club with room.
  const store = world.players;
  const deals: Array<{ p: number; from: number; to: number; fee: number }> = [];
  const lastDay = seasonEndDay(world.season + 1);
  for (const seller of world.clubs) {
    if (seller.id === world.userClubId || !followed(world, seller) || seller.players.length <= 14) continue;
    if (hash01(world.day, seller.id * 17 + 5) > 0.35) continue;
    const fringe = [...seller.players].sort((a, b) => store.currentAbility[a] - store.currentAbility[b])
      .filter((p) => loanOf(world, p) === undefined && pendingMoveOf(world, p) === undefined)[0];
    if (fringe === undefined) continue;
    const buyers = world.clubs.filter((c) => c.id !== seller.id && c.id !== world.userClubId && c.nation === seller.nation &&
      c.players.length > 0 && c.players.length < MAX_SQUAD - 1 && c.reputation >= seller.reputation - 500);
    if (buyers.length === 0) continue;
    const buyer = buyers[Math.floor(hash01(world.day, seller.id * 17 + 6) * buyers.length)];
    const fee = Math.round((store.value[fringe] * (0.8 + 0.4 * hash01(world.day, fringe))) / 1000) * 1000;
    if (fee > buyer.finances.balance) continue;
    completeTransfer(world, buyer, fringe, Math.round(store.wage[fringe] * 1.05), fee, lastDay);
    deals.push({ p: fringe, from: seller.id, to: buyer.id, fee });
    if (deals.length >= 6) break;
  }
  const ours = world.transferLog.filter((t) => t.day === world.day);
  const all = [
    ...deals,
    ...ours.map((t) => ({ p: t.playerIdx, from: t.fromClub, to: t.toClub, fee: t.fee })),
  ].sort((a, b) => b.fee - a.fee);
  if (all.length === 0) return;
  const line = (d: typeof all[number]): string =>
    `${store.fullName(d.p)}: ${world.clubs[d.from]?.shortName ?? 'free'} to ${world.clubs[d.to]?.shortName ?? 'free'}${d.fee > 0 ? ` (${euros(d.fee)})` : ''}`;
  const top = all[0];
  postNews(world, {
    kind: 'transfer',
    headline: `Deadline day: ${all.length} late deal${all.length === 1 ? '' : 's'} as the window shuts`,
    body: `The window has shut on a busy day. ${all.slice(0, 6).map(line).join('; ')}.`,
    nation: world.clubs[top.to]?.nation ?? 0,
    clubId: world.clubs[top.to] !== undefined ? top.to : undefined,
    playerIdx: top.p,
    fans: { story: 'signing', club: top.to, other: top.from >= 0 ? top.from : undefined, player: top.p, fee: top.fee },
  });
}
