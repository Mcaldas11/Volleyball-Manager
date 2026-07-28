import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { completeTransfer, evaluateFeeOffer, evaluatePersonalTerms, SquadRole } from './negotiation.ts';

test('evaluateFeeOffer accepts at valuation, rejects well below it', () => {
  const world = generateWorld({ seed: 1, startYear: 2026, scale: 'small', manager: stubManager() });
  const sellingClub = world.clubs[0];
  const playerIdx = sellingClub.players[0];

  const probe = evaluateFeeOffer(world, sellingClub, playerIdx, world.players.value[playerIdx]);
  const full = evaluateFeeOffer(world, sellingClub, playerIdx, probe.valuation);
  const lowball = evaluateFeeOffer(world, sellingClub, playerIdx, Math.round(probe.valuation * 0.3));

  assert.equal(full.accepted, true);
  assert.equal(lowball.accepted, false);
});

test('evaluatePersonalTerms accepts generous terms and rejects a lowball offer to an ambitious player', () => {
  const world = generateWorld({ seed: 2, startYear: 2026, scale: 'small', manager: stubManager() });
  const buyingClub = world.clubs[0];
  const playerIdx = world.clubs[1].players[0];
  const store = world.players;
  store.setAttr(playerIdx, 'ambition', 20);
  store.setAttr(playerIdx, 'loyalty', 10);

  const generous = evaluatePersonalTerms(
    world, buyingClub, playerIdx, store.wage[playerIdx] * 2, SquadRole.Star,
  );
  const lowball = evaluatePersonalTerms(
    world, buyingClub, playerIdx, Math.round(store.wage[playerIdx] * 0.5), SquadRole.Backup,
  );

  assert.equal(generous.accepted, true);
  assert.equal(lowball.accepted, false);
});

test('completeTransfer moves the player and settles the fee between both clubs', () => {
  const world = generateWorld({ seed: 3, startYear: 2026, scale: 'small', manager: stubManager() });
  const buyingClub = world.clubs[0];
  const sellingClub = world.clubs[1];
  const playerIdx = sellingClub.players[0];
  const store = world.players;

  const buyerBalanceBefore = buyingClub.finances.balance;
  const sellerBalanceBefore = sellingClub.finances.balance;
  const fee = 500_000;

  completeTransfer(world, buyingClub, playerIdx, 120_000, fee);

  assert.equal(store.clubId[playerIdx], buyingClub.id);
  assert.equal(store.wage[playerIdx], 120_000);
  assert.ok(buyingClub.players.includes(playerIdx));
  assert.ok(!sellingClub.players.includes(playerIdx));
  assert.equal(buyingClub.finances.balance, buyerBalanceBefore - fee);
  assert.equal(sellingClub.finances.balance, sellerBalanceBefore + fee);
});
