import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { generateWorld } from './worldGen.ts';
import { seasonEndDay, stubManager, type World } from './world.ts';
import { contractNotices } from './contracts.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { acceptIncomingOffer, openTalks, processDeals, submitOffer } from './deals.ts';
import {
  evaluateLoanRequest, generateLoanOffers, loanOf, returnLoans, squadSize, startLoan, wageBill,
} from './loans.ts';
import { generateListedBids } from './negotiation.ts';

type Club = World['clubs'][number];

function setup(seed: number): { world: World; club: Club } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12 && c.players.length < 16)!;
  world.userClubId = club.id;
  club.finances.balance = 20_000_000;
  club.finances.transferBudget = 20_000_000;
  club.finances.wageBudget = 50_000_000;
  return { world, club };
}

function runDays(world: World, max: number, done: () => boolean = () => false): void {
  for (let i = 0; i < max && !done(); i++) {
    world.day++;
    processDeals(world);
  }
}

/** Outside hitters at a club, best first. */
function outsides(world: World, club: Club): number[] {
  const store = world.players;
  return club.players
    .filter((p) => store.position[p] === Position.OutsideHitter)
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
}

/** Another club with an outside hitter to spare: not one of its two starters, with cover behind them. */
function lenderWithFringeOutside(world: World, club: Club): { lender: Club; p: number } {
  const lender = world.clubs.find((c) => c.id !== club.id && c.players.length < 16 && outsides(world, c).length >= 4)!;
  assert.ok(lender !== undefined, 'this test needs a club with four outside hitters');
  return { lender, p: outsides(world, lender)[3] };
}

test('a loan moves the player, splits his wage, and sends him home at the end of the season', () => {
  const { world, club } = setup(41);
  const { lender, p } = lenderWithFringeOutside(world, club);
  const wage = world.players.wage[p];
  const ourBill = wageBill(world, club);
  const theirBill = wageBill(world, lender);
  const theirSquad = squadSize(world, lender);

  startLoan(world, lender, club, p, 0.25);
  assert.ok(club.players.includes(p) && !lender.players.includes(p));
  assert.equal(world.players.clubId[p], club.id);
  assert.equal(squadSize(world, lender), theirSquad, 'a player out on loan still counts against his own club');
  assert.ok(Math.abs(wageBill(world, club) - (ourBill + wage * 0.25)) <= 1);
  // They still pay the three quarters the borrower doesn't.
  assert.ok(Math.abs(wageBill(world, lender) - (theirBill - wage * 0.25)) <= 1);

  returnLoans(world);
  assert.equal(loanOf(world, p), undefined);
  assert.ok(lender.players.includes(p) && !club.players.includes(p));
  assert.equal(world.players.clubId[p], lender.id);
  assert.ok(world.messages.some((m) => m.subject === `${world.players.fullName(p)} goes back to ${lender.name}`));
});

test('a club will not lend one of its first-choice players, whatever the offer', () => {
  const { world, club } = setup(42);
  const lender = world.clubs.find((c) => c.id !== club.id && outsides(world, c).length >= 2)!;
  const verdict = evaluateLoanRequest(world, lender, outsides(world, lender)[0], 1);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.final, true);
});

test('loan talks: the lending club answers days later, and a fringe player joins until the end of the season', () => {
  const { world, club } = setup(43);
  const { lender, p } = lenderWithFringeOutside(world, club);
  const t = openTalks(world, club, p, 'loan');
  assert.equal(t.stage, 'fee');

  submitOffer(world, t, { ...t.lastOffer, wageShare: 1 });
  processDeals(world);
  assert.equal(loanOf(world, p), undefined, 'nothing is answered the same day');
  // A no can be bad luck at full wages; keep asking while the talks are open.
  for (let attempt = 0; attempt < 8 && loanOf(world, p) === undefined; attempt++) {
    runDays(world, 5, () => t.pending === null);
    if (world.talks.includes(t) && t.pending === null) submitOffer(world, t, { ...t.lastOffer, wageShare: 1 });
  }
  const loan = loanOf(world, p);
  assert.ok(loan !== undefined, 'the loan should have gone through');
  assert.equal(loan.parentClubId, lender.id);
  assert.equal(loan.loanClubId, club.id);
  assert.equal(loan.wageShare, 1);
  assert.ok(club.players.includes(p));
});

test('listed players draw bids and loan offers while the window is open, and an accepted loan sends him out', () => {
  const { world, club } = setup(44);
  const store = world.players;
  const [listed, loanListed] = [...club.players].sort((a, b) => store.currentAbility[a] - store.currentAbility[b]);
  store.setFlag(listed, PlayerFlag.Transferable, true);
  store.setFlag(loanListed, PlayerFlag.LoanListed, true);

  for (let week = 0; week < 8; week++) {
    generateListedBids(world);
    generateLoanOffers(world);
    world.day += 7;
  }
  world.day = 10; // back inside the summer window
  const bids = world.incomingOffers.filter((o) => o.playerIdx === listed);
  const loanOffers = world.incomingOffers.filter((o) => o.playerIdx === loanListed);
  assert.ok(bids.length > 0 && bids.every((o) => o.loan === undefined && o.fee > 0));
  assert.ok(loanOffers.length > 0 && loanOffers.every((o) => o.fee === 0 && o.loan !== undefined));

  const offer = loanOffers[0];
  acceptIncomingOffer(world, offer);
  runDays(world, 6, () => !world.incomingOffers.includes(offer));
  const loan = loanOf(world, loanListed);
  if (loan !== undefined) {
    assert.equal(loan.loanClubId, offer.buyingClubId);
    assert.equal(loan.wageShare, offer.loan!.wageShare);
    assert.ok(!club.players.includes(loanListed));
    assert.equal(store.hasFlag(loanListed, PlayerFlag.LoanListed), false);
  } else {
    assert.ok(world.messages.some((m) => m.subject.startsWith(`${store.fullName(loanListed)} rejects`)));
  }
});

test('contract warnings cover our players out on loan, never a player only here on loan', () => {
  const { world, club } = setup(45);
  const store = world.players;
  const { lender, p: borrowedP } = lenderWithFringeOutside(world, club);
  const ours = outsides(world, club)[outsides(world, club).length - 1];
  const borrower = world.clubs.find((c) => c.id !== club.id && c.id !== lender.id && c.players.length < 16)!;
  store.contractUntil[borrowedP] = seasonEndDay(world.season);
  store.contractUntil[ours] = seasonEndDay(world.season);
  startLoan(world, lender, club, borrowedP, 0.5);
  startLoan(world, club, borrower, ours, 0.5);

  world.day = 184; // 1 January: the first warning
  contractNotices(world);
  assert.ok(world.messages.some((m) => m.subject === `Contract expiring: ${store.fullName(ours)}`));
  assert.ok(!world.messages.some((m) => m.subject === `Contract expiring: ${store.fullName(borrowedP)}`));
});

test('the season rollover sends every loan home', () => {
  const { world, club } = setup(46);
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const { lender, p } = lenderWithFringeOutside(world, club);
  startLoan(world, lender, club, p, 0.5);
  endSeason(world, ctx);
  assert.equal(world.loans.length, 0);
  assert.notEqual(world.players.clubId[p], club.id, 'he has gone back — or moved on, if his contract ran out');
  assert.ok(!club.players.includes(p));
});
