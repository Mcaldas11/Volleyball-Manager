import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import {
  completeTransfer, evaluateCounterFee, evaluateFeeOffer, evaluatePersonalTerms,
  generateIncomingOffers, MAX_PENDING_OFFERS, SquadRole,
} from './negotiation.ts';

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

test('evaluateCounterFee accepts at the ceiling, rejects well above it', () => {
  const world = generateWorld({ seed: 4, startYear: 2026, scale: 'small', manager: stubManager() });
  const buyingClub = world.clubs[0];
  const playerIdx = world.clubs[1].players[0];
  const originalOffer = world.players.value[playerIdx];

  const probe = evaluateCounterFee(world, buyingClub, playerIdx, originalOffer, originalOffer);
  const atCeiling = evaluateCounterFee(world, buyingClub, playerIdx, originalOffer, probe.valuation);
  const tooHigh = evaluateCounterFee(
    world, buyingClub, playerIdx, originalOffer, Math.round(probe.valuation * 1.3),
  );

  assert.equal(atCeiling.accepted, true);
  assert.equal(tooHigh.accepted, false);
});

test('generateIncomingOffers eventually produces an offer for one of the user\'s own players', () => {
  const world = generateWorld({ seed: 5, startYear: 2026, scale: 'small', manager: stubManager() });
  // A mid-table club, not the world's richest — otherwise nobody can afford
  // to bid for its best player and the test would be checking the wrong thing.
  const byReputation = [...world.clubs].sort((a, b) => b.reputation - a.reputation);
  world.userClubId = byReputation[Math.floor(byReputation.length / 2)].id;

  for (let i = 0; i < 300 && world.incomingOffers.length === 0; i++) {
    generateIncomingOffers(world);
    world.day += 7;
  }

  assert.ok(world.incomingOffers.length > 0, 'expected at least one incoming offer over 300 weekly ticks');
  for (const offer of world.incomingOffers) {
    assert.notEqual(offer.buyingClubId, world.userClubId);
    assert.ok(world.clubs[world.userClubId].players.includes(offer.playerIdx));
  }
});

test('generateIncomingOffers respects the pending-offer cap', () => {
  const world = generateWorld({ seed: 6, startYear: 2026, scale: 'small', manager: stubManager() });
  world.userClubId = world.clubs[0].id;
  const otherClub = world.clubs[1];
  for (let i = 0; i < MAX_PENDING_OFFERS; i++) {
    world.incomingOffers.push({
      id: world.nextOfferId++,
      playerIdx: world.clubs[world.userClubId].players[0],
      buyingClubId: otherClub.id,
      fee: 100_000,
      expiresOnDay: world.day + 100,
    });
  }
  const before = world.incomingOffers.length;
  generateIncomingOffers(world);
  assert.equal(world.incomingOffers.length, before);
});
