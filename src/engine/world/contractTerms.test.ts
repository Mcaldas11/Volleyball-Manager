import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SQUAD } from '../model/positions.ts';
import { clubBooks } from '../season/books.ts';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, seasonEndDay, stubManager, type World } from './world.ts';
import {
  agentOf, agentPatience, extrasOf, optionBlock, payAppearanceBonuses, payTitleBonuses, releaseClauseOf, setExtras,
  takeUpOption,
} from './contractTerms.ts';
import { contractDemands, evaluateFeeOffer, offerMatching, respondToOffer, smallPrintValue } from './negotiation.ts';
import { generateClauseBids, openTalks, processDeals, submitOffer } from './deals.ts';

function setup(seed: number): { world: World; club: World['clubs'][number] } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12 && c.players.length < MAX_SQUAD)!;
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

test('every player has an agent of his country, the same one every time — and some agents drive a harder bargain', () => {
  const { world } = setup(61);
  const store = world.players;
  const styles = new Set<string>();
  for (let p = 0; p < 400; p++) {
    const a = agentOf(world, p);
    assert.deepEqual(agentOf(world, p), a, 'the same agent every time');
    assert.ok(a.name.length > 3 && a.agency.length > 3);
    assert.equal(Math.floor(a.id / 12), store.nation[p], 'an agent of his own country');
    styles.add(a.style);
  }
  assert.deepEqual([...styles].sort(), ['easy', 'fair', 'hardball']);
  assert.ok(agentPatience('hardball') < agentPatience('fair') && agentPatience('fair') < agentPatience('easy'));
});

test('the agent asks for his fee, an ambitious player for a way out — and the small print is weighed like money', () => {
  const { world, club } = setup(62);
  const store = world.players;
  const others = world.clubs.filter((c) => c.id !== club.id).flatMap((c) => c.players);
  const p = others.find((q) => contractDemands(world, club, q, false).clauseMax !== null)!;
  assert.ok(p !== undefined, 'someone wants a release clause');
  const d = contractDemands(world, club, p, false);
  assert.ok((d.agentFee ?? 0) > 0 && (d.agentFee ?? 0) <= d.wage * 0.15 + 1000);
  assert.ok(d.clauseMax! >= store.value[p] && d.clauseMax! <= store.value[p] * 2.7);

  const full = offerMatching(d, d.minYears);
  assert.equal(respondToOffer(d, full, 4).outcome, 'accepted');
  // Leave out the agent, or the clause, and it is no longer his deal.
  assert.notEqual(respondToOffer(d, { ...full, agentFee: 0 }, 4).outcome, 'accepted');
  assert.notEqual(respondToOffer(d, { ...full, releaseClause: 0 }, 4).outcome, 'accepted');
  assert.notEqual(respondToOffer(d, { ...full, releaseClause: d.clauseMax! * 2 }, 4).outcome, 'accepted');
  // A lower clause than he asked for suits him.
  assert.equal(respondToOffer(d, { ...full, releaseClause: Math.round(d.clauseMax! * 0.8) }, 4).outcome, 'accepted');
  // Less wage, made up in appearance bonuses: worth it to him...
  const lessWage = { ...full, wage: Math.round(d.wage * 0.92) };
  assert.notEqual(respondToOffer(d, lessWage, 4).outcome, 'accepted');
  assert.equal(respondToOffer(d, { ...lessWage, appearanceBonus: Math.round((d.wage * 0.12) / 26) }, 4).outcome, 'accepted');
  // ...but bonuses never buy more than a sixth of the deal.
  assert.notEqual(respondToOffer(d, { ...full, wage: Math.round(d.wage * 0.6), appearanceBonus: d.wage }, 4).outcome, 'accepted');
  assert.ok(smallPrintValue(d, { ...full, option: true }) < smallPrintValue(d, full), 'the club option costs goodwill');
});

test('a contract signed with small print: the agent is paid, the clause and bonuses go in, and they hold only while he stays', () => {
  const { world, club } = setup(63);
  const store = world.players;
  world.day = 10; // the summer window is open
  const seller = world.clubs.find((c) => c.id !== club.id && c.players.length >= 12)!;
  const p = seller.players[2];
  const t = openTalks(world, club, p, 'transfer');
  t.rivals = [];
  assert.equal(t.patience, agentPatience(agentOf(world, p).style));
  const fee = Math.round(evaluateFeeOffer(world, seller, p, store.value[p]).valuation * 1.5);
  submitOffer(world, t, { ...t.lastOffer, fee });
  runDays(world, 5, () => t.pending === null);
  assert.equal(t.stage, 'terms');

  const balance = club.finances.balance;
  const terms = { ...offerMatching(t.demands, 2), appearanceBonus: 1000, titleBonus: 20_000, option: true };
  terms.releaseClause = terms.releaseClause || 3_000_000;
  terms.wage = Math.round(t.demands.wage * 1.06);
  submitOffer(world, t, { fee: t.agreedFee, ...terms });
  runDays(world, 7, () => !world.talks.includes(t));
  assert.equal(store.clubId[p], club.id, 'he signed');
  assert.equal(club.finances.balance, balance - t.agreedFee - (terms.agentFee ?? 0), 'the fee and the agent\'s are paid');
  const e = extrasOf(world, p)!;
  assert.equal(e.releaseClause, terms.releaseClause);
  assert.equal(e.appearanceBonus, 1000);
  assert.equal(e.titleBonus, 20_000);
  assert.equal(e.option, true);
  assert.equal(releaseClauseOf(world, p), terms.releaseClause);
  assert.ok(world.messages.some((m) => m.subject === `${store.fullName(p)} signs` && m.body.includes('release clause') && m.body.includes('agent')));

  // Bonuses: every match he plays, every trophy — settled with the season's books.
  const before = clubBooks(world, club).totalCosts;
  payAppearanceBonuses(world, club.id, [p, club.players[0]]);
  payTitleBonuses(world, club.id, 'Test Cup');
  assert.equal(club.finances.bonuses, 21_000);
  assert.equal(clubBooks(world, club).totalCosts, before + 21_000);
  assert.ok(world.messages.some((m) => m.subject === 'Title bonuses: Test Cup'));

  // A move or a new contract, and the small print is gone.
  store.contractUntil[p] = seasonEndDay(world.season + 4);
  assert.equal(extrasOf(world, p), undefined);
  assert.equal(releaseClauseOf(world, p), null);
});

test('a bid that meets the release clause can\'t be refused; a club meets one of yours, and only he decides', () => {
  const { world, club } = setup(64);
  const store = world.players;
  // Someone else's player with a clause.
  const theirs = world.clubs.filter((c) => c.id !== club.id).flatMap((c) => c.players).find((q) => releaseClauseOf(world, q) !== null)!;
  const clause = releaseClauseOf(world, theirs)!;
  const seller = world.clubs[store.clubId[theirs]];
  for (let i = 0; i < 20; i++) assert.ok(evaluateFeeOffer(world, seller, theirs, clause).accepted);
  // About a third of other clubs' players have one.
  const all = world.clubs.filter((c) => c.id !== club.id).flatMap((c) => c.players);
  const share = all.filter((q) => releaseClauseOf(world, q) !== null).length / all.length;
  assert.ok(share > 0.25 && share < 0.45, `share ${share}`);

  // One of ours with a low clause: a club pays it.
  world.day = 10;
  const p = [...club.players].sort((a, b) => store.currentAbility[b] - store.currentAbility[a])[0];
  setExtras(world, p, { clubId: club.id, until: store.contractUntil[p], releaseClause: Math.round(store.value[p] * 0.5) });
  for (const c of world.clubs) if (c.id !== club.id) { c.finances.transferBudget = 50_000_000; c.finances.balance = 50_000_000; }
  for (let week = 0; week < 30 && !world.incomingOffers.some((o) => o.clause === true); week++) generateClauseBids(world);
  const bid = world.incomingOffers.find((o) => o.clause === true)!;
  assert.ok(bid !== undefined, 'a club met the clause');
  assert.equal(bid.status, 'accepted', 'nothing to answer');
  assert.equal(bid.fee, Math.round(store.value[p] * 0.5));
  assert.ok(world.messages.some((m) => m.subject === `Release clause met: ${store.fullName(p)}`));
  runDays(world, 6, () => !world.incomingOffers.includes(bid));
  assert.ok(!world.incomingOffers.includes(bid), 'he has decided');
});

test('the club\'s option: one more season on the same terms, in the last season, by 1 May', () => {
  const { world, club } = setup(65);
  const store = world.players;
  const p = club.players[3];
  store.contractUntil[p] = seasonEndDay(world.season);
  setExtras(world, p, { clubId: club.id, until: store.contractUntil[p], option: true, appearanceBonus: 500 });
  world.day = world.season * DAYS_PER_SEASON + 320; // past 1 May
  assert.match(optionBlock(world, p)!, /1 May/);
  assert.equal(takeUpOption(world, p).ok, false);
  world.day = world.season * DAYS_PER_SEASON + 200;
  assert.equal(optionBlock(world, p), null);
  const wage = store.wage[p];
  assert.ok(takeUpOption(world, p).ok);
  assert.equal(store.contractUntil[p], seasonEndDay(world.season + 1));
  assert.equal(store.wage[p], wage, 'the same terms');
  const e = extrasOf(world, p)!;
  assert.equal(e.appearanceBonus, 500, 'the small print carries over');
  assert.equal(e.option, undefined, 'and the option is spent');
  assert.ok(optionBlock(world, p) !== null);
});
