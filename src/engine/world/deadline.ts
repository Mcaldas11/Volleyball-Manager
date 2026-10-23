/**
 * Deadline day, as it unfolds: planned in the morning (see market.ts), so the deadline-day screen
 * can play the day out hour by hour against a clock running down to midnight — the other clubs'
 * late deals as they break, the rumours, the bids for the manager's own players and his own talks
 * still open. The deals named here are the ones that go through when the day is done.
 */

import { PlayerFlag } from '../model/players.ts';
import { pickLateDeals, type LateDeal } from './market.ts';
import { followed } from './news.ts';
import { hash01 } from './offerStance.ts';
import { shortlistOf } from './recruitment.ts';
import { euros, type World } from './world.ts';

export interface DeadlineEvent {
  /** Minutes after midnight it happens. */
  at: number;
  kind: 'deal' | 'rumour' | 'bid' | 'talks' | 'close';
  text: string;
  p?: number;
  clubId?: number;
  fee?: number;
  /** A bid for one of the manager's players, to answer from the screen. */
  offerId?: number;
  /** One of his own talks, to open. */
  talksId?: number;
}

export interface DeadlinePlan {
  day: number;
  deals: LateDeal[];
  events: DeadlineEvent[];
}

/** The window shuts at midnight; the clock starts at nine. */
export const DEADLINE_OPENS = 9 * 60;
export const DEADLINE_SHUTS = 24 * 60;

const at = (lo: number, hi: number, k: number): number => Math.round(lo + hash01(k, 0xdd) * (hi - lo));

/** Plan the day: called on the morning of deadline day. */
export function planDeadline(world: World): DeadlinePlan {
  const store = world.players;
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const deals = pickLateDeals(world);
  const events: DeadlineEvent[] = [];
  const name = (id: number): string => world.clubs[id]?.shortName ?? 'free';

  for (const d of deals) {
    events.push({
      at: d.at, kind: 'deal', p: d.p, clubId: d.to, fee: d.fee,
      text: `${store.fullName(d.p)}: ${name(d.from)} → ${name(d.to)}${d.fee > 0 ? ` (${euros(d.fee)})` : ''}`,
    });
  }
  if (club !== undefined) {
    // The manager's own business.
    for (const t of world.talks) {
      events.push({
        at: DEADLINE_OPENS + 5 + (t.id % 20), kind: 'talks', p: t.playerIdx, talksId: t.id,
        text: t.kind === 'renewal'
          ? `Contract talks with ${store.fullName(t.playerIdx)}: still open`
          : `Your move for ${store.fullName(t.playerIdx)}: ${t.pending !== null ? 'an answer is due today' : 'the next offer is yours'}`,
      });
    }
    for (const o of world.incomingOffers.filter((x) => (x.status ?? 'open') === 'open')) {
      const buyer = world.clubs[o.buyingClubId];
      events.push({
        at: at(DEADLINE_OPENS + 15, 16 * 60, o.id * 31 + world.day), kind: 'bid', p: o.playerIdx, clubId: o.buyingClubId,
        fee: o.fee, offerId: o.id,
        text: o.loan !== undefined
          ? `${buyer?.name ?? 'A club'} want ${store.fullName(o.playerIdx)} on loan`
          : `${buyer?.name ?? 'A club'} bid ${euros(o.fee)} for ${store.fullName(o.playerIdx)}`,
      });
    }
    // The rumour mill: the men on his shortlist, and his own best.
    const rumours = shortlistOf(world).slice(0, 3);
    for (const p of rumours) {
      const suitors = world.clubs.filter((c) => c.id !== club.id && c.id !== store.clubId[p] && c.nation === world.clubs[store.clubId[p]]?.nation && c.reputation >= (world.clubs[store.clubId[p]]?.reputation ?? 0));
      const s = suitors[Math.floor(hash01(store.id[p], world.day) * suitors.length)];
      if (s === undefined) continue;
      events.push({
        at: at(10 * 60, 21 * 60, store.id[p] + world.day), kind: 'rumour', p, clubId: s.id,
        text: `${s.name} are said to be weighing a late move for ${store.fullName(p)} — one of your shortlist`,
      });
    }
    const best = [...club.players].filter((p) => !store.hasFlag(p, PlayerFlag.Youth))
      .sort((a, b) => store.currentAbility[b] - store.currentAbility[a])[0];
    if (best !== undefined && hash01(world.day, store.id[best]) < 0.5) {
      const big = world.clubs.filter((c) => c.reputation > club.reputation && c.players.length > 0)[0];
      if (big !== undefined) {
        events.push({
          at: at(12 * 60, 22 * 60, store.id[best] * 7 + world.day), kind: 'rumour', p: best, clubId: big.id,
          text: `Whispers that ${big.name} could test your resolve over ${store.fullName(best)} before midnight`,
        });
      }
    }
  }
  // The gossip around the leagues the manager follows: the bigger names, linked with late moves.
  const followedClubs = world.clubs.filter((c) => c.players.length > 0 && followed(world, c));
  const names = followedClubs.flatMap((c) => c.players.filter((p) => !store.hasFlag(p, PlayerFlag.Youth)))
    .filter((p) => !deals.some((d) => d.p === p))
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]).slice(0, 40);
  const lines = [
    (p: number, c: string): string => `${c} make a late enquiry for ${store.fullName(p)}`,
    (p: number, c: string): string => `${c} have a bid for ${store.fullName(p)} turned down`,
    (p: number, c: string): string => `Talks under way: ${store.fullName(p)} could be on his way to ${c}`,
    (p: number, c: string): string => `${store.fullName(p)} spotted at ${c}'s training centre — a medical?`,
    (p: number, c: string): string => `${c} deny any interest in ${store.fullName(p)}`,
    (p: number, c: string): string => `${store.fullName(p)}'s agent seen arriving at ${c}`,
  ];
  for (let k = 0; k < Math.min(8, names.length); k++) {
    const p = names[Math.floor(hash01(world.day, k * 13 + 1) * names.length)];
    const others = followedClubs.filter((c) => c.id !== store.clubId[p] && c.id !== world.userClubId);
    const c = others[Math.floor(hash01(world.day, k * 13 + 2) * others.length)];
    if (c === undefined || events.some((e) => e.p === p)) continue;
    events.push({
      at: at(9 * 60 + 20, 23 * 60 + 40, world.day * 31 + k), kind: 'rumour', p, clubId: c.id,
      text: lines[Math.floor(hash01(world.day, k * 13 + 3) * lines.length)](p, c.name),
    });
  }
  events.push({ at: DEADLINE_SHUTS - 1, kind: 'close', text: 'The window shuts. Anything not done now waits for the next one.' });
  events.sort((a, b) => a.at - b.at);
  const plan: DeadlinePlan = { day: world.day, deals, events };
  world.deadline = plan;
  return plan;
}

/** Today's plan, if today is deadline day. */
export function deadlineToday(world: World): DeadlinePlan | undefined {
  return world.deadline?.day === world.day ? world.deadline : undefined;
}

/** "14:05" */
export function clockLabel(minutes: number): string {
  const m = Math.max(0, Math.min(DEADLINE_SHUTS - 1, Math.floor(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
