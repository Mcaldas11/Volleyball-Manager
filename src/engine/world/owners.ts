/**
 * The club's owner: the money behind the board.
 *
 * Every club belongs to someone — its members, a local businessman, a tycoon
 * or an investment consortium — with his own means, ambition and patience.
 * Each summer he sets the manager something of his own to do beyond the
 * board's league target: a trophy, a profit, the young players given their
 * chance, a place near the top. Meet it and he is pleased, and the board with
 * him; miss it and they are not — the less patient, the less pleased.
 *
 * The manager can go to him for money: he answers in a few days, as his means
 * and his goodwill allow, and every euro he puts in costs some of that
 * goodwill. A rich owner bails the club out of the red at the end of a season.
 * And now and then the club changes hands — likelier when it is in debt or the
 * owner has had enough — and the new man comes with his own ideas.
 */

import type { Club } from '../model/club.ts';
import { postMessage } from './inbox.ts';
import { bankFor } from './names.ts';
import { NATIONS } from './nations.ts';
import { hash01 } from './offerStance.ts';
import { seasonTotals } from './records.ts';
import { finalStandingsOrder } from '../season/playoffs.ts';
import { euros, type World } from './world.ts';

export type OwnerKind = 'members' | 'local' | 'tycoon' | 'consortium';

export const OWNER_KIND_NAMES: Readonly<Record<OwnerKind, string>> = {
  members: 'Members\' club', local: 'Local businessman', tycoon: 'Tycoon', consortium: 'Investment consortium',
};

export interface Owner {
  name: string;
  kind: OwnerKind;
  /** 1-5 each. */
  wealth: number;
  ambition: number;
  patience: number;
  /** The season he took over. */
  since: number;
  /** 0-100: how he feels about the manager. */
  goodwill: number;
}

export type DemandKind = 'trophy' | 'profit' | 'youth' | 'top3';

/** What the owner wants this season, beyond the board's target. */
export interface OwnerDemand {
  kind: DemandKind;
  season: number;
  /** The balance as the season began — for a profit. */
  startBalance: number;
  /** Trophies lifted this season, counted as they are won. */
  trophies?: number;
  /** Settled at the season's end. */
  met?: boolean;
}

export const DEMAND_TEXT: Readonly<Record<DemandKind, string>> = {
  trophy: 'Win a trophy this season — any of them.',
  profit: 'Finish the season with more money in the bank than it started with.',
  youth: 'Give three players of 21 or under ten competitive matches each.',
  top3: 'Finish in the league\'s top three.',
};

/** A request for money, waiting on the owner. */
export interface OwnerAsk {
  amount: number;
  until: number;
}

const CONSORTIA = ['Meridian Capital', 'Northgate Partners', 'Crescent Holdings', 'Harbor Sports Group', 'Summit Equity', 'Bluewater Investments'] as const;

/** A new owner for a club, drawn on its own dice — `n` for how many have owned it before. */
function newOwner(world: World, club: Club, n: number): Owner {
  const r = (k: number): number => hash01(club.id * 131 + n * 7919, k);
  const rep = club.reputation / 10000;
  // A big club draws the money; a small one is its members' or a local man's.
  const roll = r(1);
  const kind: OwnerKind = rep > 0.6
    ? (roll < 0.35 ? 'tycoon' : roll < 0.7 ? 'consortium' : roll < 0.9 ? 'local' : 'members')
    : (roll < 0.1 ? 'tycoon' : roll < 0.25 ? 'consortium' : roll < 0.65 ? 'local' : 'members');
  const span = (lo: number, hi: number, k: number): number => lo + Math.floor(r(k) * (hi - lo + 1));
  const wealth = kind === 'members' ? 1 : kind === 'local' ? span(2, 3, 2) : kind === 'tycoon' ? span(4, 5, 2) : span(3, 4, 2);
  const ambition = kind === 'tycoon' ? span(4, 5, 3) : kind === 'consortium' ? 3 : kind === 'local' ? span(2, 4, 3) : span(2, 3, 3);
  const patience = kind === 'members' ? 5 : kind === 'local' ? span(3, 4, 4) : kind === 'consortium' ? span(2, 3, 4) : span(1, 3, 4);
  const bank = bankFor(NATIONS[club.nation]?.nameGroup ?? '');
  const person = `${bank.first[Math.floor(r(5) * bank.first.length)]} ${bank.last[Math.floor(r(6) * bank.last.length)]}`;
  const name = kind === 'members' ? `${club.name} Members' Trust` : kind === 'consortium' ? CONSORTIA[Math.floor(r(7) * CONSORTIA.length)] : person;
  return { name, kind, wealth, ambition, patience, since: world.season, goodwill: 60 };
}

/** A club's owner — found the first time anyone asks. */
export function ownerOf(world: World, club: Club): Owner {
  return (club.owner ??= newOwner(world, club, 0));
}

/** What the owner could put in, at most, in one go: his means, at the club's scale. */
export function ownerMeans(world: World, club: Club): number {
  const o = ownerOf(world, club);
  const base = 60_000 * (0.4 + club.reputation / 10000);
  return Math.round((base * o.wealth * o.wealth) / 10_000) * 10_000;
}

/** What he wants of this season, by who he is. */
function demandFor(world: World, club: Club, o: Owner): DemandKind {
  const strong = club.tier === 1 && club.reputation / 10000 > 0.55;
  switch (o.kind) {
    case 'tycoon': return strong ? 'trophy' : 'top3';
    case 'consortium': return 'profit';
    case 'local': return strong && o.ambition >= 3 ? 'top3' : 'youth';
    case 'members': return world.season % 2 === 0 ? 'youth' : 'profit';
  }
}

/** The summer: the manager's club may change hands, and its owner sets his demand. Called as each season starts. */
export function ownerSeasonStart(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return;
  let o = ownerOf(world, club);
  // A takeover: likelier for a club in debt, or an owner who has had enough.
  if (world.season > 0) {
    const chance = 0.04 + (club.finances.balance < 0 ? 0.1 : 0) + (o.goodwill < 25 ? 0.08 : 0) + (club.reputation > 7000 ? 0.03 : 0);
    if (hash01(club.id * 7 + world.season, 0x7a4e) < chance) {
      const previous = o.name;
      o = club.owner = newOwner(world, club, world.season);
      club.boardConfidence = Math.round((club.boardConfidence + 55) / 2);
      const kitty = o.kind === 'tycoon' || o.kind === 'consortium' ? ownerMeans(world, club) : 0;
      if (kitty > 0) {
        club.finances.balance += kitty;
        club.finances.transferBudget += kitty;
      }
      postMessage(world, {
        category: 'board', from: 'The Board',
        subject: `Takeover: ${o.name} buys the club`,
        body: `${previous} has sold the club to ${o.name} (${OWNER_KIND_NAMES[o.kind].toLowerCase()}). ` +
          (kitty > 0 ? `The new owner has put ${euros(kitty)} into the transfer budget as a statement of intent. ` : '') +
          'He will judge you on his own terms — the board is keeping an open mind for now.',
      });
    }
  }
  setDemand(world, club, o);
}

/** The owner's wish for the season, and his word of it. */
function setDemand(world: World, club: Club, o: Owner): void {
  club.ownerDemand = { kind: demandFor(world, club, o), season: world.season, startBalance: club.finances.balance };
  postMessage(world, {
    category: 'board', from: o.name,
    subject: 'The owner\'s wish for the season',
    body: `${o.name} has a wish of his own for the season, beyond the board's target: ${DEMAND_TEXT[club.ownerDemand.kind].toLowerCase()} ` +
      (o.patience <= 2 ? 'He is not a patient man.' : o.patience >= 4 ? 'He will not hold a miss against you for long.' : ''),
  });
}

/** How the season's demand stands, worked out from the world as it is. */
export function demandProgress(world: World, club: Club): { done: boolean; text: string } {
  const d = club.ownerDemand;
  if (d === undefined) return { done: false, text: '—' };
  switch (d.kind) {
    case 'trophy': {
      const won = d.trophies ?? 0;
      return { done: won > 0, text: won > 0 ? `${won} won` : 'None yet' };
    }
    case 'profit': {
      const diff = club.finances.balance - d.startBalance;
      return { done: diff >= 0, text: `${diff >= 0 ? '+' : '−'}${euros(Math.abs(diff))} on the summer` };
    }
    case 'youth': {
      const store = world.players;
      const kids = club.players.filter((p) => store.ageOn(p, world.year, 181) <= 21 && seasonTotals(world, p).apps >= 10).length;
      return { done: kids >= 3, text: `${kids} of 3` };
    }
    case 'top3': {
      const comp = world.competitions[club.leagueId];
      // Where the club finished — the playoffs have their say — or stands.
      const order = comp === undefined ? [] : finalStandingsOrder(comp);
      const at = order.indexOf(club.id) + 1;
      return { done: at > 0 && at <= 3, text: at > 0 ? `${at}${at === 1 ? 'st' : at === 2 ? 'nd' : at === 3 ? 'rd' : 'th'} now` : '—' };
    }
  }
}

/** A trophy lifted: counted towards an owner's wish for one. Called as each is won. */
export function noteTrophy(world: World, clubId: number): void {
  const d = world.clubs[clubId]?.ownerDemand;
  if (d !== undefined && d.season === world.season) d.trophies = (d.trophies ?? 0) + 1;
}

/**
 * The season is over: the owner's verdict on his wish — and, if the club ended
 * in the red, a rich owner's money to put it right. Called by the rollover,
 * once the titles are settled and the books balanced.
 */
export function ownerSeasonEnd(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  const d = club?.ownerDemand;
  if (club === undefined) return;
  const o = ownerOf(world, club);
  if (d !== undefined && d.season === world.season && d.met === undefined) {
    const { done } = demandProgress(world, club);
    d.met = done;
    const cost = 4 + 2 * (5 - o.patience);
    club.boardConfidence = Math.max(0, Math.min(100, club.boardConfidence + (done ? 8 : -cost)));
    o.goodwill = Math.max(0, Math.min(100, o.goodwill + (done ? 15 : -15)));
    postMessage(world, {
      category: 'board', from: o.name,
      subject: done ? 'The owner is pleased' : 'The owner is disappointed',
      body: done
        ? `${o.name} wanted this: ${DEMAND_TEXT[d.kind].toLowerCase()} You delivered, and the board has noticed.`
        : `${o.name} asked for one thing — ${DEMAND_TEXT[d.kind].toLowerCase()} It did not happen, and he has made sure the board knows how he feels.`,
    });
  }
  // A rich owner won't see the club in the red.
  const f = club.finances;
  if (f.balance < 0 && o.wealth >= 3) {
    const put = Math.min(-f.balance, ownerMeans(world, club) * 2);
    f.balance += put;
    o.goodwill = Math.max(0, o.goodwill - 25);
    postMessage(world, {
      category: 'board', from: o.name,
      subject: 'The owner covers the losses',
      body: `The club finished the season ${euros(-(f.balance - put))} in the red. ${o.name} has put in ${euros(put)} to cover it — ` +
        'but he will not do it every year.',
    });
  }
}

/** Why the manager can't go to the owner for money now — or null when he can. */
export function askBlock(world: World, club: Club): string | null {
  if (club.ownerAsk !== undefined) return 'He is still considering your last request.';
  if ((club.ownerRefusedUntil ?? -1) > world.day) return `He said no — ask again in ${club.ownerRefusedUntil! - world.day} days.`;
  return null;
}

/** Go to the owner for money for transfers. He answers in a few days. */
export function askOwner(world: World, club: Club, amount: number): string {
  const block = askBlock(world, club);
  if (block !== null) return block;
  club.ownerAsk = { amount, until: world.day + 3 + Math.floor(hash01(world.day, club.id) * 4) };
  return `You have asked ${ownerOf(world, club).name} for ${euros(amount)}. He will let you know.`;
}

/** Each day: the owner's answer, when it is due. */
export function ownerDay(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return;
  // A manager new to the club — or the first season of a career — hears the owner's wish too.
  if (club.ownerDemand === undefined || club.ownerDemand.season !== world.season) setDemand(world, club, ownerOf(world, club));
  const ask = club.ownerAsk;
  if (ask === undefined || ask.until > world.day) return;
  club.ownerAsk = undefined;
  const o = ownerOf(world, club);
  const means = ownerMeans(world, club);
  // He gives what his means allow, to a manager he believes in.
  const share = ask.amount / Math.max(1, means);
  const chance = Math.max(0, Math.min(0.95,
    0.2 + (o.goodwill - 50) / 100 + (club.boardConfidence - 50) / 120 + o.ambition * 0.06 - Math.max(0, share - 0.5) * 0.8));
  const yes = share <= 1 && hash01(world.day * 13 + club.id, 0x0a5c) < chance;
  if (yes) {
    club.finances.balance += ask.amount;
    club.finances.transferBudget += ask.amount;
    o.goodwill = Math.max(0, o.goodwill - Math.round(10 + share * 15));
    postMessage(world, {
      category: 'board', from: o.name,
      subject: `The owner puts in ${euros(ask.amount)}`,
      body: `${o.name} has agreed: ${euros(ask.amount)} goes into the transfer budget. Spend it well — he will be watching.`,
    });
    return;
  }
  club.ownerRefusedUntil = world.day + 60;
  postMessage(world, {
    category: 'board', from: o.name,
    subject: 'The owner says no',
    body: share > 1
      ? `${o.name} does not have ${euros(ask.amount)} to put in. Ask for something he can manage.`
      : o.goodwill < 40
        ? `${o.name} is not ready to put more money in on your say-so. Win him round first.`
        : `${o.name} will not put more in just now. Ask again in a couple of months.`,
  });
}
