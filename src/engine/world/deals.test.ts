import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { seasonEndDay, stubManager, type World } from './world.ts';
import { evaluateFeeOffer } from './negotiation.ts';
import {
  acceptIncomingOffer, counterIncomingOffer, openTalks, processDeals, REPLY_DAYS, submitOffer, type Talks,
} from './deals.ts';

function setup(seed: number): { world: World; club: World['clubs'][number] } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12 && c.players.length < 16)!;
  world.userClubId = club.id;
  club.finances.balance = 20_000_000;
  club.finances.transferBudget = 20_000_000;
  club.finances.wageBudget = 50_000_000;
  return { world, club };
}

/** Advance day by day, running the deals, until `done` or `max` days pass. */
function runDays(world: World, max: number, done: () => boolean = () => false): void {
  for (let i = 0; i < max && !done(); i++) {
    world.day++;
    processDeals(world);
  }
}

test('a renewal is never answered in under two days', () => {
  const { world, club } = setup(31);
  const p = club.players[0];
  world.players.contractUntil[p] = seasonEndDay(world.season);
  const t = openTalks(world, club, p, 'renewal');
  const offer = { fee: 0, wage: t.demands.wage, role: t.demands.role, years: t.demands.minYears };
  const due = submitOffer(world, t, offer);
  assert.ok(due - world.day >= REPLY_DAYS.renewal[0] && REPLY_DAYS.renewal[0] >= 2);

  runDays(world, 1);
  assert.ok(world.talks.some((x) => x.id === t.id), 'still waiting after one day');
  assert.equal(world.players.contractUntil[p], seasonEndDay(world.season));

  runDays(world, 10, () => !world.talks.some((x) => x.id === t.id));
  assert.equal(world.players.contractUntil[p], seasonEndDay(world.season + offer.years - 1));
  assert.ok(world.messages.some((m) => m.subject === `New contract: ${world.players.fullName(p)}`));
});

test('a bid takes days to answer; once accepted, terms follow — and the player signs', () => {
  const { world, club } = setup(32);
  const seller = world.clubs.find((c) => c.id !== club.id && c.players.length >= 12)!;
  const p = seller.players[0];
  const t = openTalks(world, club, p, 'transfer');
  t.rivals = [];
  assert.equal(t.stage, 'fee');

  const valuation = evaluateFeeOffer(world, seller, p, world.players.value[p]).valuation;
  submitOffer(world, t, { ...t.lastOffer, fee: Math.round(valuation * 1.5) });
  processDeals(world);
  assert.equal(t.stage, 'fee', 'nothing is answered the same day');
  runDays(world, 5, () => t.pending === null);
  assert.equal(t.stage, 'terms');
  assert.ok(world.messages.some((m) => m.talksId === t.id && m.subject.startsWith('Bid accepted')));

  submitOffer(world, t, { fee: t.agreedFee, wage: t.demands.wage, role: t.demands.role, years: t.demands.minYears });
  runDays(world, 10, () => !world.talks.some((x) => x.id === t.id));
  assert.equal(world.players.clubId[p], club.id);
  assert.ok(club.players.includes(p));
});

test('a rival offering him more can take the player from under you', () => {
  const { world, club } = setup(33);
  const free = club.players.find((q) => q !== undefined)!;
  // Make a free agent to chase.
  club.players = club.players.filter((q) => q !== free);
  world.players.clubId[free] = -1;
  const t: Talks = openTalks(world, club, free, 'transfer');
  const rival = world.clubs.find((c) => c.id !== club.id && c.reputation >= club.reputation)!;
  t.rivals = [{ clubId: rival.id, wage: Math.round(t.demands.wage * 1.6) }];

  submitOffer(world, t, { fee: 0, wage: t.demands.wage, role: t.demands.role, years: t.demands.minYears });
  runDays(world, 10, () => !world.talks.some((x) => x.id === t.id));
  assert.equal(world.players.clubId[free], rival.id, 'he took the better offer');
  assert.ok(world.messages.some((m) => m.subject === `${world.players.fullName(free)} joins ${rival.name}`));
});

test('talks left idle lapse — or a rival gets there first', () => {
  const { world, club } = setup(34);
  const seller = world.clubs.find((c) => c.id !== club.id && c.players.length >= 12)!;
  const t = openTalks(world, club, seller.players[3], 'transfer');
  runDays(world, 40, () => !world.talks.some((x) => x.id === t.id));
  assert.ok(!world.talks.some((x) => x.id === t.id));
});

test('selling a player: the fee agreed, he takes days to decide; a counter waits for their board', () => {
  const { world, club } = setup(35);
  world.day = 5; // summer window
  const [a, b] = club.players;
  const buyer = world.clubs.find((c) => c.id !== club.id && c.players.length < 16)!;
  world.incomingOffers.push(
    { id: 100, playerIdx: a, buyingClubId: buyer.id, fee: world.players.value[a], expiresOnDay: world.day + 14, status: 'open' },
    { id: 101, playerIdx: b, buyingClubId: buyer.id, fee: world.players.value[b], expiresOnDay: world.day + 14, status: 'open' },
  );
  const accepted = world.incomingOffers.find((o) => o.id === 100)!;
  const due = acceptIncomingOffer(world, accepted);
  assert.ok(due - world.day >= REPLY_DAYS.decision[0]);
  processDeals(world);
  assert.equal(world.players.clubId[a], club.id, 'he has not decided yet');
  runDays(world, 6, () => !world.incomingOffers.some((o) => o.id === 100));
  assert.ok(!world.incomingOffers.some((o) => o.id === 100));
  assert.ok(world.messages.some((m) => m.subject.includes(world.players.fullName(a))));

  const countered = world.incomingOffers.find((o) => o.id === 101)!;
  counterIncomingOffer(world, countered, Math.round(countered.fee * 1.05));
  assert.equal(countered.status, 'countered');
  runDays(world, 3, () => countered.status !== 'countered');
  assert.notEqual(countered.status, 'countered', 'they answered');
});

test('a bid for one of your players can draw a higher rival bid while the window is open', () => {
  const { world, club } = setup(36);
  world.day = 2;
  const star = [...club.players].sort((x, y) => world.players.currentAbility[y] - world.players.currentAbility[x])[0];
  const buyer = world.clubs.find((c) => c.id !== club.id)!;
  for (const c of world.clubs) { c.finances.transferBudget = 50_000_000; c.finances.balance = 50_000_000; }
  const fee = world.players.value[star];
  world.incomingOffers.push({ id: 200, playerIdx: star, buyingClubId: buyer.id, fee, expiresOnDay: 62, status: 'open' });
  runDays(world, 55, () => world.incomingOffers.filter((o) => o.playerIdx === star).length > 1);
  const bids = world.incomingOffers.filter((o) => o.playerIdx === star);
  assert.ok(bids.length > 1, 'a rival joined in');
  assert.ok(bids.every((o) => o.fee >= fee));
});
