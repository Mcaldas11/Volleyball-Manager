import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SQUAD } from '../model/positions.ts';
import { PlayerFlag } from '../model/players.ts';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, seasonEndDay, stubManager, type World } from './world.ts';
import { offerMatching } from './negotiation.ts';
import { completeDueMoves, openPreContractTalks, processDeals, submitOffer } from './deals.ts';
import { pendingMoveOf } from './moves.ts';
import { preContractBlock, preContractJoinDay } from './preContracts.ts';
import { agentPoaching } from './agents.ts';

function setup(): { world: World; club: World['clubs'][number] } {
  const world = generateWorld({ seed: 57, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12 && c.players.length < MAX_SQUAD)!;
  world.userClubId = club.id;
  club.finances.balance = 20_000_000;
  club.finances.transferBudget = 20_000_000;
  club.finances.wageBudget = 50_000_000;
  return { world, club };
}

/** A player at another club, in his prime, good enough but not too good for the user's club. */
function target(world: World, clubId: number): number {
  const store = world.players;
  const club = world.clubs[clubId];
  for (let p = 0; p < store.count; p++) {
    if (!store.isActive(p) || store.clubId[p] < 0 || store.clubId[p] === clubId || store.hasFlag(p, PlayerFlag.Youth)) continue;
    const age = store.ageOn(p, world.year, 181);
    if (age < 22 || age > 29 || store.currentAbility[p] / 2000 > club.reputation / 10000 + 0.1) continue;
    return p;
  }
  throw new Error('no target');
}

function daysUntil(world: World, max: number, done: () => boolean): void {
  for (let i = 0; i < max && !done(); i++) {
    world.day++;
    processDeals(world);
  }
}

test('a pre-contract is open only in the last six months of a contract', () => {
  const { world, club } = setup();
  const store = world.players;
  const p = target(world, club.id);
  const start = world.season * DAYS_PER_SEASON;
  // A contract with a season still to run after this one: not yet.
  store.contractUntil[p] = seasonEndDay(world.season + 1);
  world.day = start + 200;
  assert.match(preContractBlock(world, p) ?? '', /last six months/);
  // Ending this June, but still autumn: from 1 January.
  store.contractUntil[p] = seasonEndDay(world.season);
  world.day = start + 120;
  assert.match(preContractBlock(world, p) ?? '', /from 1 January/);
  // 1 January: open.
  world.day = start + 184;
  assert.equal(preContractBlock(world, p), null);
  // Never the manager's own players, nor free agents.
  assert.match(preContractBlock(world, club.players[0]) ?? '', /your own player/);
  // Out of work, there is no club to sign him for.
  world.userClubId = -1;
  assert.match(preContractBlock(world, p) ?? '', /need a club/);
});

test('a pre-contract costs no fee, and he joins when his contract runs out', () => {
  const { world, club } = setup();
  const store = world.players;
  const p = target(world, club.id);
  const from = store.clubId[p];
  store.contractUntil[p] = seasonEndDay(world.season);
  world.day = world.season * DAYS_PER_SEASON + 200;
  const sellerBalance = world.clubs[from].finances.balance;

  const t = openPreContractTalks(world, club, p);
  assert.equal(t.stage, 'terms', 'straight to his terms');
  assert.equal(t.agreedFee, 0);
  t.rivals = [];
  const offer = { fee: 0, ...offerMatching(t.demands, Math.max(t.demands.minYears, 2)) };
  submitOffer(world, t, offer);
  daysUntil(world, 10, () => !world.talks.some((x) => x.id === t.id));

  const move = pendingMoveOf(world, p);
  assert.ok(move !== undefined, 'a deal signed');
  assert.equal(move!.fee, 0);
  assert.equal(move!.preContract, true);
  assert.equal(move!.movesOn, preContractJoinDay(world));
  assert.equal(move!.contractEnd, seasonEndDay(world.season + offer.years), 'years count from next season');
  // He stays — and plays — where he is until the summer; his club gets nothing.
  assert.equal(store.clubId[p], from);
  assert.equal(world.clubs[from].finances.balance, sellerBalance);
  assert.ok(world.messages.some((m) => m.playerIdx === p && /pre-contract/.test(m.subject)));
  assert.ok(world.news.some((n) => n.playerIdx === p && /on a free/.test(n.headline)));
  // Not again, nor by anyone else.
  assert.match(preContractBlock(world, p) ?? '', /already agreed to join/);

  // The winter window opening changes nothing: only his contract running out does.
  completeDueMoves(world, world.season * DAYS_PER_SEASON + 300);
  assert.equal(store.clubId[p], from);
  completeDueMoves(world, (world.season + 1) * DAYS_PER_SEASON);
  assert.equal(store.clubId[p], club.id);
  assert.equal(store.wage[p], offer.wage);
  assert.equal(store.contractUntil[p], move!.contractEnd);
});

test('his club renewing him ends the pre-contract talks', () => {
  const { world, club } = setup();
  const store = world.players;
  const p = target(world, club.id);
  store.contractUntil[p] = seasonEndDay(world.season);
  world.day = world.season * DAYS_PER_SEASON + 200;
  const t = openPreContractTalks(world, club, p);
  store.contractUntil[p] = seasonEndDay(world.season + 2);
  world.day++;
  processDeals(world);
  assert.ok(!world.talks.some((x) => x.id === t.id));
});

test('other clubs approach the manager\'s unrenewed players for pre-contracts', () => {
  const { world, club } = setup();
  const store = world.players;
  for (const p of club.players) if (!store.hasFlag(p, PlayerFlag.Youth) && store.ageOn(p, world.year, 181) < 30) store.contractUntil[p] = seasonEndDay(world.season);
  world.day = world.season * DAYS_PER_SEASON + 215;
  const taken = agentPoaching(world);
  assert.ok(taken.length > 0);
  const p = taken[0];
  assert.ok(world.messages.some((m) => m.playerIdx === p && m.category === 'contract'), 'the inbox hears');
  assert.ok(world.news.some((n) => n.playerIdx === p && /on a free/.test(n.headline)), 'and the papers');
});
