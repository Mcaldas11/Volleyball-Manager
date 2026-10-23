import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';
import { appointManager } from './career.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { contractFeeFactor, generateIncomingOffers, type IncomingOffer } from './negotiation.ts';
import { bidTurnedDown, stanceOf } from './offerStance.ts';
import { messageNeedsAction } from './inbox.ts';
import { answerGrievance, blockedMovesDay, CONTRACT_PROMISE_DAYS } from './blockedMoves.ts';

function managed(seed: number): { world: World; club: World['clubs'][number] } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12).sort((a, b) => b.reputation - a.reputation)[1];
  appointManager(world, club.id);
  return { world, club };
}

/** A bid from the biggest club, to a man with no games here — keen on it, unless he is loyal to a fault. */
function bigBid(world: World, club: World['clubs'][number], p: number, id: number, fee = 200_000): IncomingOffer {
  const big = world.clubs.reduce((a, b) => (b.reputation > a.reputation && b.id !== club.id ? b : a));
  world.players.morale[p] = 30;
  world.players.playingTime[p] = 5;
  return { id, playerIdx: p, buyingClubId: big.id, fee, expiresOnDay: world.day + 14, status: 'open' };
}

/** A bid the player wants. */
function keenBid(world: World, club: World['clubs'][number], p: number, id: number, fee = 200_000): IncomingOffer {
  const offer = bigBid(world, club, p, id, fee);
  assert.equal(stanceOf(world, offer), 'keen');
  return offer;
}

/** His request to leave, if he has made one. */
const requestOf = (world: World, p: number) => world.transferRequests?.[p];

test('the years left on his contract set what a bid for him is worth', () => {
  const { world, club } = managed(91);
  const p = club.players[0];
  const at = (days: number): number => {
    world.players.contractUntil[p] = world.day + days;
    return contractFeeFactor(world, p);
  };
  assert.ok(at(120) < 0.5, 'months from free: cheap');
  assert.ok(at(300) < at(600) && at(600) < at(900), 'the more years, the dearer');
  assert.ok(at(1100) >= 1.1, 'three years left: above his value');
});

test('bids for a man tied down come in at his value or above; for one whose deal is running out, well below', () => {
  const world = generateWorld({ seed: 5, startYear: 2026, scale: 'small', manager: stubManager() });
  const byReputation = [...world.clubs].sort((a, b) => b.reputation - a.reputation);
  const club = byReputation[Math.floor(byReputation.length / 2)];
  world.userClubId = club.id;
  world.day = 10;
  const store = world.players;
  const bidsWith = (days: number): IncomingOffer[] => {
    world.incomingOffers = [];
    for (const p of club.players) store.contractUntil[p] = world.day + days;
    const out: IncomingOffer[] = [];
    for (let i = 0; i < 600 && out.length < 6; i++) {
      generateIncomingOffers(world);
      out.push(...world.incomingOffers.filter((o) => !out.includes(o)));
      world.incomingOffers = [];
    }
    return out;
  };
  const tied = bidsWith(3 * 365);
  assert.ok(tied.length > 0, 'somebody bid');
  for (const o of tied) assert.ok(o.fee >= store.value[o.playerIdx] * 0.95, `${o.fee} for a man valued ${store.value[o.playerIdx]}`);
  const running = bidsWith(150);
  assert.ok(running.length > 0, 'somebody bid');
  for (const o of running) assert.ok(o.fee <= store.value[o.playerIdx] * 0.65, `${o.fee} for a man valued ${store.value[o.playerIdx]}`);
});

test('turn down a move he wanted and he asks for a word; tell him the right offer will do, then turn that one down, and he asks to leave', () => {
  const { world, club } = managed(92);
  const p = club.players[3];
  const offer = keenBid(world, club, p, 1);
  bidTurnedDown(world, offer, 'declined');
  const msg = world.messages.find((m) => m.moveTalkOf === p);
  assert.ok(msg !== undefined && messageNeedsAction(world, msg), 'the word is waiting');
  const result = answerGrievance(world, club, p, 'nextOffer');
  assert.ok(result !== null && result.morale > 0);
  assert.ok(!messageNeedsAction(world, msg!), 'answered');
  assert.equal(world.movePromises?.[p]?.kind, 'sale');
  assert.equal(requestOf(world, p), undefined);

  // The right offer comes — and is turned down.
  const again = keenBid(world, club, p, 2, 190_000);
  bidTurnedDown(world, again, 'declined');
  assert.equal(requestOf(world, p)?.status, 'open');
  assert.equal(world.movePromises?.[p], undefined);
  assert.ok(world.messages.some((m) => m.transferRequestOf === p && m.body.includes('your word')));
});

test('a better contract promised has to come: six weeks without one and he asks to leave; given one, he is content', () => {
  const { world, club } = managed(93);
  const store = world.players;
  // Who takes the money depends on the man: find two that do.
  const takers: number[] = [];
  for (const [i, p] of club.players.entries()) {
    if (takers.length === 2) break;
    const offer = bigBid(world, club, p, 10 + i);
    if (stanceOf(world, offer) !== 'keen') continue;
    bidTurnedDown(world, offer, 'declined');
    const result = answerGrievance(world, club, p, 'contract')!;
    if (world.movePromises?.[p]?.kind === 'contract') takers.push(p);
    else assert.ok(result.morale < 0, 'not about the money');
  }
  assert.equal(takers.length, 2, 'two took the promise');
  const [kept, broken] = takers;
  store.contractUntil[kept] += 2 * 365;
  world.day += CONTRACT_PROMISE_DAYS;
  const before = store.morale[kept];
  blockedMovesDay(world);
  assert.ok(store.morale[kept] > before, 'a promise kept');
  assert.equal(requestOf(world, kept), undefined);
  assert.equal(requestOf(world, broken)?.status, 'open', 'a promise broken');
});

test('telling a bench player he is too important to sell insults him', () => {
  const { world, club } = managed(94);
  const store = world.players;
  const bench = [...club.players].sort((a, b) => store.currentAbility[a] - store.currentAbility[b])[0];
  const offer = keenBid(world, club, bench, 1);
  bidTurnedDown(world, offer, 'declined');
  const before = store.morale[bench];
  const result = answerGrievance(world, club, bench, 'important')!;
  assert.ok(result.morale < 0 && store.morale[bench] < before);
  assert.equal(answerGrievance(world, club, bench, 'firm'), null, 'nothing left to talk about');
});
