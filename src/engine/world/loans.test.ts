import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { generateWorld } from './worldGen.ts';
import { seasonEndDay, stubManager, type World } from './world.ts';
import { contractNotices } from './contracts.ts';
import { advanceDay, newSeasonContext, pickLineup, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { acceptIncomingOffer, counterLoanOffer, openTalks, processDeals, submitOffer } from './deals.ts';
import {
  evaluateLoanCounter, evaluateLoanRequest, generateLoanOffers, loanOf, loanShare, playingTimeOnOffer,
  requestLoanReport, returnLoans, reviewLoanPromises, squadSize, startLoan, wageBill,
} from './loans.ts';
import { generateListedBids, type IncomingOffer } from './negotiation.ts';
import { weeklyTraining } from './progression.ts';

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

/** One of ours on the fringe, and a club he would not get into on merit: two better outside hitters. */
function fringeOutAndBorrower(world: World, club: Club): { p: number; borrower: Club } {
  const store = world.players;
  const p = outsides(world, club)[outsides(world, club).length - 1];
  const borrower = world.clubs.find((c) => c.id !== club.id && c.players.length < 16 &&
    outsides(world, c).filter((q) => store.currentAbility[q] > store.currentAbility[p]).length >= 2)!;
  assert.ok(borrower !== undefined, 'this test needs a club with two better outside hitters');
  return { p, borrower };
}

test('a player the lineup would leave out starts when he must', () => {
  const { world, club } = setup(51);
  const worst = outsides(world, club)[outsides(world, club).length - 1];
  assert.ok(!pickLineup(world.players, club).lineup.includes(worst), 'on merit he is on the bench');
  assert.ok(pickLineup(world.players, club, new Set([worst])).lineup.includes(worst));
});

test('a club that promised a loanee a starting place gives him the games, and his matches can be compiled', () => {
  const { world, club } = setup(52);
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const { p, borrower } = fringeOutAndBorrower(world, club);
  const loan = startLoan(world, club, borrower, p, 0.5, undefined, 'starter');
  while ((loan.stats?.clubMatches ?? 0) < 8 && world.day < 250) advanceDay(world, ctx);

  assert.ok(loan.stats!.clubMatches >= 8, 'his club has played');
  assert.ok(loanShare(loan.stats) >= 0.6, `he has played most of it (${loanShare(loan.stats).toFixed(2)})`);
  assert.ok(loan.stats!.apps >= 6);

  const message = requestLoanReport(world, p);
  assert.ok(message !== null);
  const report = message.loanReport!;
  assert.equal(report.playingTime, 'starter');
  assert.equal(report.stats.apps, loan.stats!.apps);
  assert.ok(report.stats.ratingSum > 0 && report.verdict.length > 0);
  assert.equal(report.final, false);

  returnLoans(world);
  const back = world.messages.find((m) => m.subject === `${world.players.fullName(p)} returns from loan`);
  assert.ok(back?.loanReport?.final === true, 'the return brings the final report');
  assert.equal(requestLoanReport(world, p), null, 'nothing left to compile once he is back');
});

test('a club only promises the games its squad can give, and haggles within that', () => {
  const { world, club } = setup(53);
  const { p, borrower } = fringeOutAndBorrower(world, club);
  const most = playingTimeOnOffer(world, borrower, p);
  assert.notEqual(most, 'starter', 'two better outside hitters stand in his way');
  const refused = evaluateLoanCounter(world, borrower, p,
    { wageShare: 0.5, playingTime: most }, { wageShare: 0.5, playingTime: 'starter' });
  assert.equal(refused.accepted, false);
  assert.match(refused.reason, /can't promise/);

  // Terms within what they can give are usually agreed.
  let agreed = 0;
  for (let i = 0; i < 20; i++) {
    if (evaluateLoanCounter(world, borrower, p, { wageShare: 0.5, playingTime: 'backup' }, { wageShare: 0.5, playingTime: most }).accepted) agreed++;
  }
  assert.ok(agreed >= 8, `${agreed} of 20`);
});

test('a loan offer can be countered for more playing time, and the agreed terms go on the loan', () => {
  const { world, club } = setup(54);
  const store = world.players;
  world.day = 10; // the summer window is open
  const p = outsides(world, club)[outsides(world, club).length - 1];
  store.contractUntil[p] = seasonEndDay(world.season + 1);
  // A club where he would start: none of its outside hitters is better than him.
  const borrower = world.clubs.find((c) => c.id !== club.id && c.players.length < 16 &&
    playingTimeOnOffer(world, c, p) === 'starter')!;
  assert.ok(borrower !== undefined);
  const offer: IncomingOffer = {
    id: world.nextOfferId++, playerIdx: p, buyingClubId: borrower.id, fee: 0,
    loan: { wageShare: 0.25, playingTime: 'rotation' }, expiresOnDay: world.day + 14, status: 'open',
  };
  world.incomingOffers.push(offer);

  for (let attempt = 0; attempt < 6 && offer.loan?.playingTime !== 'starter'; attempt++) {
    if ((offer.status ?? 'open') === 'open') counterLoanOffer(world, offer, { wageShare: 0.25, playingTime: 'starter' });
    runDays(world, 3, () => offer.status !== 'countered');
  }
  assert.equal(offer.loan?.playingTime, 'starter', 'they came round to a starting place');
  assert.ok(world.messages.some((m) => m.subject === `Loan terms agreed: ${store.fullName(p)}`));

  runDays(world, 6, () => !world.incomingOffers.includes(offer));
  const loan = loanOf(world, p);
  if (loan !== undefined) {
    assert.equal(loan.playingTime, 'starter');
    assert.ok(world.messages.some((m) => m.loanOut === true && m.playerIdx === p), 'the move comes with its compile button');
  } else {
    assert.ok(world.messages.some((m) => m.subject.startsWith(`${store.fullName(p)} rejects`)));
  }
});

test('a lender complains when its player is denied the promised games, then recalls him', () => {
  const { world, club } = setup(55);
  const { lender, p } = lenderWithFringeOutside(world, club);
  const loan = startLoan(world, lender, club, p, 0.5, undefined, 'starter');
  const name = world.players.fullName(p);
  loan.stats = { ...loan.stats!, clubMatches: 6, clubRallies: 900, rallies: 50, apps: 1 };
  reviewLoanPromises(world);
  assert.ok(world.messages.some((m) => m.subject === `${lender.name} unhappy with ${name}'s playing time`));
  assert.equal(loanOf(world, p), loan, 'a warning first');

  loan.stats = { ...loan.stats, clubMatches: 12, clubRallies: 1800 };
  reviewLoanPromises(world);
  assert.equal(loanOf(world, p), undefined);
  assert.ok(lender.players.includes(p) && !club.players.includes(p));
  assert.ok(world.messages.some((m) => m.subject === `${name} recalled by ${lender.name}`));
});

test('a young player who plays develops faster than one on the bench', () => {
  const grow = (minutes: number): number => {
    const world = generateWorld({ seed: 56, startYear: 2026, scale: 'small', manager: stubManager() });
    const store = world.players;
    // The same youngster in both worlds: a good deal of room left to grow.
    let pick = -1;
    for (let i = 0; i < store.count && pick < 0; i++) {
      if (store.clubId[i] >= 0 && store.ageOn(i, world.year, 181) <= 20 &&
        store.potentialAbility[i] - store.currentAbility[i] > 300) pick = i;
    }
    assert.ok(pick >= 0);
    const before = store.currentAbility[pick];
    for (let week = 0; week < 20; week++) {
      store.playingTime[pick] = minutes;
      weeklyTraining(world);
    }
    return store.currentAbility[pick] - before;
  };
  const playing = grow(100);
  const benched = grow(0);
  assert.ok(playing > benched * 1.5, `playing ${playing} vs benched ${benched}`);
});
