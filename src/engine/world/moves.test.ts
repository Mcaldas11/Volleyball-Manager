import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SQUAD, Position } from '../model/positions.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';
import { generateWorld } from './worldGen.ts';
import { seasonEndDay, stubManager, type World } from './world.ts';
import { evaluateFeeOffer } from './negotiation.ts';
import { acceptIncomingOffer, openTalks, processDeals, submitOffer, type Talks } from './deals.ts';
import { loanOf } from './loans.ts';
import { pendingMoveOf } from './moves.ts';

type Club = World['clubs'][number];

/** Mid-October: the summer window shut in September, January's opens on day 184. */
const WINDOW_SHUT = 100;
const WINTER_OPENS = 184;

function setup(seed: number): { world: World; club: Club } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  // Room in the squad for a signing or two.
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12 && c.players.length <= MAX_SQUAD - 2)!;
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

/** A young regular at another club — young, so he can't retire before a summer move. */
function target(world: World, club: Club): { seller: Club; p: number } {
  const store = world.players;
  for (const seller of world.clubs) {
    if (seller.id === club.id || seller.players.length < 12) continue;
    const p = seller.players.find((q) => store.ageOn(q, world.year, 181) <= 26);
    if (p !== undefined) return { seller, p };
  }
  throw new Error('no young player found');
}

/** Agree a fee and then terms, answering every reply — until the talks close. */
function buy(world: World, t: Talks): void {
  t.rivals = [];
  const seller = world.clubs[t.sellingClubId]!;
  const fee = Math.round(evaluateFeeOffer(world, seller, t.playerIdx, world.players.value[t.playerIdx]).valuation * 1.5);
  submitOffer(world, t, { ...t.lastOffer, fee });
  runDays(world, 5, () => t.pending === null);
  assert.equal(t.stage, 'terms', 'a bid half as much again over his valuation should be accepted');
  const years = Math.min(t.demands.maxYears, Math.max(t.demands.minYears, 2));
  submitOffer(world, t, { fee: t.agreedFee, wage: t.demands.wage, role: t.demands.role, years });
  runDays(world, 7, () => !world.talks.includes(t));
  assert.ok(!world.talks.includes(t), 'terms matching his demands should be accepted');
}

test('a signing agreed with the window shut is paid for now, and he joins when it opens', () => {
  const { world, club } = setup(51);
  world.day = WINDOW_SHUT;
  const { seller, p } = target(world, club);
  const balance = club.finances.balance;
  const t = openTalks(world, club, p, 'transfer');
  buy(world, t);

  const move = pendingMoveOf(world, p);
  assert.ok(move !== undefined && move.toClubId === club.id);
  assert.equal(move.movesOn, WINTER_OPENS);
  assert.equal(world.players.clubId[p], seller.id, 'he stays where he is until the window opens');
  assert.equal(club.finances.balance, balance - t.agreedFee, 'the fee is paid when the deal is done');
  assert.ok(world.messages.some((m) => m.subject === `${world.players.fullName(p)} signs` && m.body.includes('window is shut')));

  runDays(world, WINTER_OPENS - world.day - 1);
  assert.equal(world.players.clubId[p], seller.id, 'not a day early');
  runDays(world, 1);
  assert.equal(world.players.clubId[p], club.id);
  assert.ok(club.players.includes(p) && !seller.players.includes(p));
  assert.equal(pendingMoveOf(world, p), undefined);
  assert.equal(club.finances.balance, balance - t.agreedFee, 'and the fee is not paid twice');
});

test('a deal done after the January window waits for the summer one, contract counted from then', () => {
  const { world, club } = setup(52);
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  world.day = 250; // March
  const { p } = target(world, club);
  const t = openTalks(world, club, p, 'transfer');
  buy(world, t);
  const years = t.lastOffer.years;
  assert.equal(pendingMoveOf(world, p)?.movesOn, 365, 'the summer window opens with the next season');

  endSeason(world, ctx);
  assert.equal(world.players.clubId[p], club.id);
  assert.equal(world.players.contractUntil[p], seasonEndDay(1 + years - 1), 'his contract runs from the season he joins');
});

test('a sale agreed with the window shut: the fee comes in now, and he leaves when it opens', () => {
  const { world, club } = setup(53);
  world.day = WINDOW_SHUT;
  const store = world.players;
  const p = [...club.players].sort((a, b) => store.currentAbility[a] - store.currentAbility[b])[0];
  const buyers = world.clubs.filter((c) => c.id !== club.id && c.reputation > club.reputation);
  const balance = club.finances.balance;
  let fee = 0;
  // The player has the final say; ask him about a few moves until one appeals.
  for (const buyer of buyers.slice(0, 8)) {
    fee = store.value[p];
    const offer = { id: world.nextOfferId++, playerIdx: p, buyingClubId: buyer.id, fee, expiresOnDay: world.day + 14, status: 'open' as const };
    world.incomingOffers.push(offer);
    acceptIncomingOffer(world, offer);
    runDays(world, 5, () => !world.incomingOffers.includes(offer));
    if (pendingMoveOf(world, p) !== undefined) break;
  }
  const move = pendingMoveOf(world, p);
  assert.ok(move !== undefined, 'one of the moves should have appealed to him');
  assert.ok(club.players.includes(p), 'he stays until the window opens');
  assert.equal(club.finances.balance, balance + fee);

  runDays(world, WINTER_OPENS - world.day);
  assert.ok(!club.players.includes(p));
  assert.equal(store.clubId[p], move.toClubId);
});

test('a loan agreed with the window shut starts when it opens and runs to the end of that season', () => {
  const { world, club } = setup(54);
  world.day = WINDOW_SHUT;
  const store = world.players;
  const lender = world.clubs.find((c) => c.id !== club.id &&
    c.players.filter((q) => store.position[q] === Position.OutsideHitter).length >= 4)!;
  const p = lender.players
    .filter((q) => store.position[q] === Position.OutsideHitter)
    .sort((a, b) => store.currentAbility[b] - store.currentAbility[a])[3];
  const t = openTalks(world, club, p, 'loan');
  for (let attempt = 0; attempt < 8 && pendingMoveOf(world, p) === undefined && world.talks.includes(t); attempt++) {
    if (t.pending === null) submitOffer(world, t, { ...t.lastOffer, wageShare: 1 });
    runDays(world, 5, () => t.pending === null);
  }
  assert.equal(pendingMoveOf(world, p)?.kind, 'loan', 'the loan should have been agreed');
  assert.equal(store.clubId[p], lender.id);

  runDays(world, WINTER_OPENS - world.day);
  const loan = loanOf(world, p);
  assert.ok(loan !== undefined && loan.loanClubId === club.id);
  assert.equal(loan.endsOn, seasonEndDay(0));
  assert.ok(club.players.includes(p));
});
