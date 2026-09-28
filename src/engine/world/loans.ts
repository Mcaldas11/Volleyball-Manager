/**
 * Loans.
 *
 * A loan sends a player to another club until the end of the season while
 * his contract — and his way back — stays with the club that owns him. The
 * borrowing club picks him, plays him and trains him as one of its own; his
 * wage is split between the two clubs as agreed; on 30 June he goes home.
 *
 * Loans always involve the user's club, one way or the other: the user
 * borrows players from other clubs, and other clubs borrow the user's.
 */

import type { Club } from '../model/club.ts';
import { PlayerFlag } from '../model/players.ts';
import { Position, POSITION_NAMES } from '../model/positions.ts';
import { arrivalsFor, moveDay, pendingMoveOf, pendingWages, seasonOfDay } from './moves.ts';
import type { IncomingOffer } from './negotiation.ts';
import { euros, seasonEndDay, type GameMessage, type World } from './world.ts';

export interface Loan {
  playerIdx: number;
  /** The club he is contracted to, and goes back to. */
  parentClubId: number;
  /** The club he plays for until then. */
  loanClubId: number;
  /** Share of his wage the borrowing club pays, 0-1; his own club pays the rest. */
  wageShare: number;
  /** Absolute day the loan runs to: 30 June, the end of the season. */
  endsOn: number;
}

/** Most players a club can have on its books — its own out on loan included. */
export const MAX_SQUAD = 16;

/** The wage shares a loan can be agreed at. */
export const LOAN_WAGE_SHARES: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

/** Players each position needs to field the six and a libero. */
const STARTERS_AT: Readonly<Record<Position, number>> = {
  [Position.Setter]: 1,
  [Position.Opposite]: 1,
  [Position.OutsideHitter]: 2,
  [Position.MiddleBlocker]: 2,
  [Position.Libero]: 1,
};

/** Chance each week, while a window is open, that a listed player draws an offer. */
const LOAN_OFFER_CHANCE = 0.4;
/** Most loan offers one player can have on the table at once. */
const MAX_LOAN_OFFERS = 2;

function say(world: World, msg: Omit<GameMessage, 'id' | 'day' | 'year'>): void {
  world.messages.push({ id: world.messages.length, day: world.day, year: world.year, ...msg });
}

export function loanOf(world: World, playerIdx: number): Loan | undefined {
  return world.loans.find((l) => l.playerIdx === playerIdx);
}

/** A club's own players currently out on loan elsewhere. */
export function loansOutOf(world: World, clubId: number): Loan[] {
  return world.loans.filter((l) => l.parentClubId === clubId);
}

/**
 * What a club pays its players this season: the whole wage of its own, the
 * agreed share for anyone it has borrowed, and the rest of the wage of anyone
 * it has lent out.
 */
export function wageBill(world: World, club: Club): number {
  const wage = world.players.wage;
  let bill = 0;
  for (const p of club.players) {
    const loan = world.loans.length > 0 ? loanOf(world, p) : undefined;
    bill += loan !== undefined && loan.loanClubId === club.id ? wage[p] * loan.wageShare : wage[p];
  }
  for (const loan of world.loans) {
    if (loan.parentClubId === club.id) bill += wage[loan.playerIdx] * (1 - loan.wageShare);
  }
  return Math.round(bill);
}

/** Room left in a club's wage budget, once players who have agreed to join are paid for. */
export function wageRoom(world: World, club: Club): number {
  return club.finances.wageBudget - wageBill(world, club) - pendingWages(world, club.id);
}

/** Players a club answers for against the squad limit: everyone at the club,
 *  its own players out on loan, who will be back at the end of the season,
 *  and anyone who has agreed to join and is waiting on the window. */
export function squadSize(world: World, club: Club): number {
  return club.players.length + loansOutOf(world, club.id).length + arrivalsFor(world, club.id).length;
}

/** Send a player out on loan — until the end of the season, unless told otherwise. */
export function startLoan(
  world: World,
  parent: Club,
  borrower: Club,
  playerIdx: number,
  wageShare: number,
  endsOn = seasonEndDay(world.season),
): Loan {
  const store = world.players;
  parent.players = parent.players.filter((p) => p !== playerIdx);
  borrower.players.push(playerIdx);
  store.clubId[playerIdx] = borrower.id;
  store.setFlag(playerIdx, PlayerFlag.LoanListed, false);
  store.setFlag(playerIdx, PlayerFlag.Transferable, false);
  const loan: Loan = {
    playerIdx,
    parentClubId: parent.id,
    loanClubId: borrower.id,
    wageShare,
    endsOn,
  };
  world.loans.push(loan);
  return loan;
}

/** Bring a player on loan back to the club that owns him. */
export function endLoan(world: World, loan: Loan): void {
  const store = world.players;
  const p = loan.playerIdx;
  world.loans = world.loans.filter((l) => l !== loan);
  const borrower = world.clubs[loan.loanClubId];
  if (borrower !== undefined) borrower.players = borrower.players.filter((q) => q !== p);
  const parent = world.clubs[loan.parentClubId];
  if (parent === undefined || !store.isActive(p)) {
    store.clubId[p] = -1;
    return;
  }
  if (!parent.players.includes(p)) parent.players.push(p);
  store.clubId[p] = parent.id;
}

/** The season is over: every player on loan goes home, and the user hears who. */
export function returnLoans(world: World): void {
  const store = world.players;
  for (const loan of [...world.loans]) {
    const name = store.fullName(loan.playerIdx);
    const borrower = world.clubs[loan.loanClubId];
    const parent = world.clubs[loan.parentClubId];
    endLoan(world, loan);
    if (loan.parentClubId === world.userClubId && borrower !== undefined) {
      say(world, {
        subject: `${name} returns from loan`,
        body: `${name}'s loan at ${borrower.name} is over, and he is back with the squad.`,
        playerIdx: loan.playerIdx,
        clubId: borrower.id,
        category: 'offer',
      });
    } else if (loan.loanClubId === world.userClubId && parent !== undefined) {
      say(world, {
        subject: `${name} goes back to ${parent.name}`,
        body: `${name}'s loan has ended, and he returns to ${parent.name}.`,
        playerIdx: loan.playerIdx,
        clubId: parent.id,
        category: 'offer',
      });
    }
  }
}

/** The owning club's answer to a request to borrow one of its players. */
export interface LoanVerdict {
  accepted: boolean;
  /** A refusal that no better offer will change: talks end. */
  final: boolean;
  reason: string;
}

/**
 * Will a club lend one of its players out? Never a first-choice player, never
 * if it would leave the club short of a team; beyond that it is about money —
 * the more of his wage the borrower covers, the likelier — and about a young
 * player getting games, which clubs like.
 */
export function evaluateLoanRequest(world: World, parent: Club, playerIdx: number, wageShare: number): LoanVerdict {
  const store = world.players;
  const pos = store.position[playerIdx] as Position;
  const samePos = parent.players
    .filter((p) => store.position[p] === pos)
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  const needed = STARTERS_AT[pos];
  if (samePos.indexOf(playerIdx) < needed) {
    return {
      accepted: false,
      final: true,
      reason: `He is one of their first-choice ${POSITION_NAMES[pos].toLowerCase()}s and is not available for loan.`,
    };
  }
  const left = samePos.length - 1;
  if (left < needed) {
    return { accepted: false, final: true, reason: 'They cannot spare him — without him they could not field a team.' };
  }
  const age = store.ageOn(playerIdx, world.year, 181);
  let chance = 0.15 + wageShare * 0.75 + (age <= 23 ? 0.15 : 0);
  // Lending their only cover in the position is a risk they rarely take.
  if (left === needed) chance *= 0.4;
  if (world.rng.chance(Math.min(0.95, chance))) {
    return { accepted: true, final: false, reason: 'They agree to the loan.' };
  }
  return {
    accepted: false,
    final: false,
    reason: wageShare < 0.75 ? 'They want you to cover more of his wages.' : 'They would rather keep him for now.',
  };
}

/** Does the player want the loan? Most want games; an ambitious one won't drop far down for them. */
export function playerAgreesToLoan(world: World, borrower: Club, playerIdx: number): boolean {
  const store = world.players;
  const level = store.currentAbility[playerIdx] / 2000;
  const clubLevel = borrower.reputation / 10000;
  if (level <= clubLevel + 0.2) return true;
  const ambition = store.getAttr(playerIdx, 'ambition') / 20;
  return !world.rng.chance(ambition * 0.8);
}

/**
 * Clubs that could use the user's loan-listed players make offers to borrow
 * them — clubs at or below his level, where he would play, with room in the
 * squad and the wage budget. Called weekly, all year: a loan agreed while the
 * window is shut starts when it opens.
 */
export function generateLoanOffers(world: World): void {
  const club = world.userClubId >= 0 ? world.clubs[world.userClubId] : undefined;
  if (club === undefined) return;
  const store = world.players;

  for (const p of club.players) {
    if (!store.hasFlag(p, PlayerFlag.LoanListed) || loanOf(world, p) !== undefined) continue;
    if (pendingMoveOf(world, p) !== undefined) continue;
    // A loan runs to the end of the season it starts in; his contract must outlast it.
    if (store.contractUntil[p] < seasonEndDay(seasonOfDay(moveDay(world)))) continue;
    const open = world.incomingOffers.filter((o) => o.playerIdx === p && o.loan !== undefined);
    if (open.length >= MAX_LOAN_OFFERS || !world.rng.chance(LOAN_OFFER_CHANCE)) continue;

    const level = store.currentAbility[p] / 2000;
    const wage = Math.max(1, store.wage[p]);
    const suitors = world.clubs.filter((c) =>
      c.id !== club.id && c.players.length > 0 && squadSize(world, c) < MAX_SQUAD &&
      c.reputation / 10000 >= level - 0.3 && c.reputation / 10000 <= level + 0.05 &&
      wageRoom(world, c) >= wage * 0.25 && !open.some((o) => o.buyingClubId === c.id));
    if (suitors.length === 0) continue;
    const borrower = world.rng.pick(suitors);
    // The most they can put in, in quarters, and something up to that.
    const most = Math.min(1, Math.floor((wageRoom(world, borrower) / wage) * 4) / 4);
    const wageShare = Math.max(0.25, Math.round(world.rng.range(0.25, most) * 4) / 4);

    const offer: IncomingOffer = {
      id: world.nextOfferId++,
      playerIdx: p,
      buyingClubId: borrower.id,
      fee: 0,
      loan: { wageShare },
      expiresOnDay: world.day + 14,
      status: 'open',
    };
    world.incomingOffers.push(offer);
    say(world, {
      subject: `Loan offer for ${store.fullName(p)}`,
      body: `${borrower.name} would like to take ${store.fullName(p)} on loan to the end of the season, ` +
        `paying ${Math.round(wageShare * 100)}% of his ` +
        `${euros(store.wage[p])} wage. Accept it or turn it down.`,
      offerId: offer.id,
      playerIdx: p,
      from: borrower.name,
      clubId: borrower.id,
      category: 'offer',
    });
  }
}
