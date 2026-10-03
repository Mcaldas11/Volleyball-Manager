import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerFlag } from '../model/players.ts';
import { Position } from '../model/positions.ts';
import { newPlayerStats, type PlayerMatchStats } from '../match/stats.ts';
import { generateWorld } from './worldGen.ts';
import { seasonEndDay, stubManager, type Fixture, type World } from './world.ts';
import { contractNotices } from './contracts.ts';
import { advanceDay, newSeasonContext, pickLineup, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { acceptIncomingOffer, counterLoanOffer, openTalks, processDeals, submitOffer } from './deals.ts';
import { monthlyLoanReports } from './inbox.ts';
import {
  canRecall, coachRequests, coachTalkBlock, evaluateLoanCounter, evaluateLoanRequest, fitMatches, generateLoanOffers, loanOf,
  loanStarters, playingTimeOnOffer, promiseShare, recallFromLoan, recordLoanMatch, requestLoanReport, returnLoans,
  reviewLoanPromises, squadSize, startLoan, talkToLoanCoach, wageBill, type Loan,
} from './loans.ts';
import { generateListedBids, type IncomingOffer } from './negotiation.ts';
import { rollInjuries, weeklyTraining } from './progression.ts';

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
  loan.honour = 1; // a club as good as its word
  // Measured over the matches he was fit for: an injury is nobody's broken promise.
  while ((loan.stats?.fitMatches ?? 0) < 8 && world.day < 300) advanceDay(world, ctx);

  assert.ok((loan.stats!.fitMatches ?? 0) >= 8, 'his club has played');
  assert.ok(promiseShare(loan.stats) >= 0.6, `he has played most of it (${promiseShare(loan.stats).toFixed(2)})`);
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
  loan.stats = { ...loan.stats!, clubMatches: 6, clubRallies: 900, fitMatches: 6, fitRallies: 900, rallies: 50, apps: 1 };
  reviewLoanPromises(world);
  assert.ok(world.messages.some((m) => m.subject === `${lender.name} unhappy with ${name}'s playing time`));
  assert.equal(loanOf(world, p), loan, 'a warning first');

  loan.stats = { ...loan.stats, clubMatches: 12, clubRallies: 1800, fitMatches: 12, fitRallies: 1800 };
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

/** One of ours out on loan to a club that has played, with a record to report on. */
function loanedOut(seed: number): { world: World; club: Club; borrower: Club; p: number; loan: Loan } {
  const { world, club } = setup(seed);
  startSeason(world, newSeasonContext());
  const { p, borrower } = fringeOutAndBorrower(world, club);
  const loan = startLoan(world, club, borrower, p, 0.5, undefined, 'starter');
  return { world, club, borrower, p, loan };
}

/** A finished match between the loan club and someone, with the loanee's line in it. */
function playedMatch(world: World, borrower: Club, line: PlayerMatchStats, mvp: boolean): Fixture {
  const opponent = world.clubs.find((c) => c.id !== borrower.id && c.leagueId === borrower.leagueId)!;
  return {
    id: 999_999, competitionId: borrower.leagueId, day: world.day, home: borrower.id, away: opponent.id, round: 0,
    format: world.fixtures[0].format, importance: 0.4, neutralVenue: false, played: true,
    homeSets: 3, awaySets: 1, setScores: [[25, 20], [23, 25], [25, 18], [25, 21]], mvp: mvp ? line.playerIdx : -1,
  };
}

function bigNight(p: number): PlayerMatchStats {
  return {
    ...newPlayerStats(p), ralliesPlayed: 182, attacksTotal: 44, attackKills: 26, attackErrors: 2, attackBlocked: 1,
    serveAces: 4, servesTotal: 18, blockPoints: 4, receptionsTotal: 20, receptionPerfect: 11, receptionPositive: 6,
    digsTotal: 12, plusMinus: 14,
  };
}

test('each month brings an update on every loanee whose club has played', () => {
  const { world, p, loan } = loanedOut(61);
  const name = world.players.fullName(p);
  loan.stats = { ...loan.stats!, clubMatches: 4, clubRallies: 700, fitMatches: 4, fitRallies: 700, apps: 4, rallies: 690, ratingSum: 27.2 };
  world.day = 92; // 1 October: September's update
  monthlyLoanReports(world);
  const update = world.messages.find((m) => m.subject === `Loan update: ${name} — September 2026`);
  assert.ok(update?.loanReport?.month !== undefined, 'the month on its own');
  assert.equal(update.loanReport.month.stats.clubMatches, 4);
  assert.equal(update.loanOut, true);

  world.day = 123; // 1 November, and no matches since
  monthlyLoanReports(world);
  assert.ok(!world.messages.some((m) => m.subject === `Loan update: ${name} — October 2026`), 'nothing to report');

  loan.stats = { ...loan.stats, clubMatches: 7, clubRallies: 1200, apps: 6 };
  world.day = 153; // 1 December
  monthlyLoanReports(world);
  const november = world.messages.find((m) => m.subject === `Loan update: ${name} — November 2026`);
  assert.equal(november?.loanReport?.month?.stats.clubMatches, 3, 'only the month just gone');
});

test('the user hears when a loanee is injured, and when he is fit again', () => {
  const { world, borrower, p } = loanedOut(62);
  const store = world.players;
  const name = store.fullName(p);
  // Injury-prone and worn out: sooner or later he goes down.
  store.setAttr(p, 'injuryProneness', 20);
  for (let week = 0; week < 400 && store.injuryDaysLeft[p] === 0; week++) {
    store.condition[p] = 20;
    rollInjuries(world);
  }
  assert.ok(store.injuryDaysLeft[p] > 0);
  assert.ok(world.messages.some((m) => m.subject === `${name} injured on loan at ${borrower.name}` && m.category === 'medical'));

  store.injuryDaysLeft[p] = 1;
  advanceDay(world, newSeasonContext());
  assert.ok(world.messages.some((m) => m.subject === `${name} fit again at ${borrower.name}`));
});

test('a standout match by a loanee makes the inbox — though not every week', () => {
  const { world, borrower, p } = loanedOut(63);
  const name = world.players.fullName(p);
  const line = bigNight(p);
  recordLoanMatch(world, playedMatch(world, borrower, line, true), new Map([[p, line]]), new Map());
  const news = world.messages.filter((m) => m.subject === `${name} player of the match for ${borrower.name}`);
  assert.equal(news.length, 1);
  assert.match(news[0].body, /3-1/);

  world.day += 7;
  recordLoanMatch(world, playedMatch(world, borrower, line, true), new Map([[p, line]]), new Map());
  assert.equal(world.messages.filter((m) => m.subject === `${name} player of the match for ${borrower.name}`).length, 1);
});

test('matches missed through injury do not count against a promise of games', () => {
  const { world, borrower, p, loan } = loanedOut(64);
  world.players.injuryDaysLeft[p] = 20;
  recordLoanMatch(world, playedMatch(world, borrower, newPlayerStats(-1), false), new Map(), new Map());
  assert.equal(loan.stats!.clubMatches, 1);
  assert.equal(loan.stats!.fitMatches, 0);
  assert.equal(promiseShare(loan.stats), 0);
  assert.equal(fitMatches(loan.stats), 0);
});

test('a club not as good as its word leaves an owed loanee out', () => {
  const { world, borrower, p, loan } = loanedOut(65);
  loan.honour = 0;
  assert.equal(loanStarters(world, borrower), undefined);
  loan.honour = 1;
  assert.ok(loanStarters(world, borrower)?.has(p));
});

test('a loan club short-changing him on games is reported, and the user can recall him', () => {
  const { world, club, borrower, p, loan } = loanedOut(66);
  const name = world.players.fullName(p);
  assert.equal(canRecall(world, p), false, 'nothing to complain about yet');
  loan.stats = { ...loan.stats!, clubMatches: 8, clubRallies: 1400, fitMatches: 8, fitRallies: 1400, apps: 3, rallies: 300 };
  reviewLoanPromises(world);
  const alert = world.messages.find((m) => m.subject === `${name} short of his promised games at ${borrower.name}`);
  assert.ok(alert?.loanRecall === true);
  assert.ok(canRecall(world, p));

  reviewLoanPromises(world);
  assert.equal(world.messages.filter((m) => m.subject === alert.subject).length, 1, 'not again straight away');

  assert.equal(recallFromLoan(world, p), true);
  assert.equal(loanOf(world, p), undefined);
  assert.ok(club.players.includes(p) && !borrower.players.includes(p));
  assert.equal(world.messages[world.messages.length - 1].loanReport?.final, true);
});

/** One of ours on loan at a club where his level earns him a rotation place: exactly two better outside hitters. */
function loanedForRotation(seed: number, promise: 'starter' | 'rotation' | 'backup'): { world: World; borrower: Club; p: number; loan: Loan } {
  const { world, club } = setup(seed);
  startSeason(world, newSeasonContext());
  const store = world.players;
  const p = outsides(world, club)[outsides(world, club).length - 1];
  const borrower = world.clubs.find((c) => c.id !== club.id && c.players.length < 16 &&
    outsides(world, c).filter((q) => store.currentAbility[q] > store.currentAbility[p]).length === 2)!;
  assert.ok(borrower !== undefined, 'this test needs a club with exactly two better outside hitters');
  const loan = startLoan(world, club, borrower, p, 0.5, undefined, promise);
  return { world, borrower, p, loan };
}

/** He has been fit for eight matches and on court for a fifth of the play. */
function benched(loan: Loan): void {
  loan.stats = { ...loan.stats!, clubMatches: 8, clubRallies: 1400, fitMatches: 8, fitRallies: 1400, apps: 3, rallies: 280, ratingSum: 20 };
}

test('a loanee\'s coach can be spoken to once he is playing too little — and not every week', () => {
  const { world, p, loan } = loanedForRotation(71, 'starter');
  assert.match(coachTalkBlock(world, p) ?? '', /few matches/);
  loan.stats = { ...loan.stats!, clubMatches: 8, clubRallies: 1400, fitMatches: 8, fitRallies: 1400, apps: 8, rallies: 1350 };
  assert.match(coachTalkBlock(world, p) ?? '', /getting his games/);

  benched(loan);
  assert.equal(coachTalkBlock(world, p), null);
  assert.deepEqual(coachRequests(world, p), ['starter'], 'only the deal itself: there is nothing above a starting place');
  const name = world.players.fullName(p);
  const result = talkToLoanCoach(world, p, 'starter', false);
  assert.ok(result !== null && result.reply.length > 0);
  assert.ok(world.messages.some((m) => m.playerIdx === p && m.loanOut === true &&
    (m.subject.includes(`agrees to play ${name} more`) || m.subject.includes(`won't give ${name} more games`))));
  assert.equal(talkToLoanCoach(world, p, 'starter', false), null, 'not again straight away');
  assert.match(coachTalkBlock(world, p) ?? '', /only recently/);
  world.day += 21;
  assert.equal(coachTalkBlock(world, p), null);
});

test('a coach will not give a loanee more than his squad allows', () => {
  const { world, p, loan } = loanedForRotation(72, 'backup');
  let agreed = 0;
  for (let i = 0; i < 30; i++) {
    loan.coachTalkOn = undefined;
    loan.playingTime = 'backup';
    benched(loan);
    if (talkToLoanCoach(world, p, 'starter', false)?.agreed === true) agreed++;
  }
  assert.ok(agreed <= 6, `${agreed} of 30`);
});

test('a coach who agrees keeps his word: the deal honoured, or the playing time raised', () => {
  const upgrade = loanedForRotation(73, 'backup');
  let raised = false;
  for (let i = 0; i < 30 && !raised; i++) {
    upgrade.loan.coachTalkOn = undefined;
    benched(upgrade.loan);
    raised = talkToLoanCoach(upgrade.world, upgrade.p, 'rotation', false)?.agreed === true;
  }
  assert.ok(raised, 'within his squad\'s means, he comes round');
  assert.equal(upgrade.loan.playingTime, 'rotation');

  const deal = loanedForRotation(74, 'starter');
  let kept = false;
  for (let i = 0; i < 30 && !kept; i++) {
    deal.loan.coachTalkOn = undefined;
    deal.loan.honour = 0.4;
    benched(deal.loan);
    kept = talkToLoanCoach(deal.world, deal.p, 'starter', true)?.agreed === true;
  }
  assert.ok(kept);
  assert.equal(deal.loan.honour, 1, 'from now on he keeps to it');
});

test('a firm word he refuses leaves the coach less inclined to keep his word', () => {
  const { world, p, loan } = loanedForRotation(75, 'backup');
  let dug = false;
  for (let i = 0; i < 40 && !dug; i++) {
    loan.coachTalkOn = undefined;
    loan.playingTime = 'backup';
    loan.honour = 0.9;
    benched(loan);
    dug = talkToLoanCoach(world, p, 'rotation', true)?.reply.startsWith('I don\'t appreciate') === true;
  }
  assert.ok(dug);
  assert.ok(loan.honour! < 0.9);
});
