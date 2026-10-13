import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import { appointNationalCoach } from './internationals.ts';
import type { IncomingOffer } from './negotiation.ts';
import { bidTurnedDown, stanceOf, stanceOnAgreedSale } from './offerStance.ts';
import { changesOfMind } from './playerTalks.ts';
import { assistantReport, nationalFormReport, scoutingReport } from './reports.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

function managed(seed: number): { world: World; club: World['clubs'][number] } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12).sort((a, b) => b.reputation - a.reputation)[1];
  appointManager(world, club.id);
  return { world, club };
}

/** A bid for `p` from `buyer`, put on the table. */
function bid(world: World, p: number, buyer: number, id: number): IncomingOffer {
  const offer: IncomingOffer = { id, playerIdx: p, buyingClubId: buyer, fee: 100_000, expiresOnDay: world.day + 14, status: 'open' };
  world.incomingOffers.push(offer);
  return offer;
}

test('a player has his say on a bid: a bigger club and no games make him keen; settled, playing and loyal, he wants to stay', () => {
  const { world, club } = managed(81);
  const store = world.players;
  const p = club.players[0];
  const big = world.clubs.reduce((a, b) => (b.reputation > a.reputation && b.id !== club.id ? b : a));
  const small = world.clubs.filter((c) => c.id !== club.id).reduce((a, b) => (b.reputation < a.reputation ? b : a));
  store.morale[p] = 20;
  store.playingTime[p] = 5;
  assert.equal(stanceOf(world, bid(world, p, big.id, 1)), 'keen');
  store.morale[p] = 95;
  store.playingTime[p] = 95;
  assert.equal(stanceOf(world, bid(world, p, small.id, 2)), 'staying');
});

test('turn down a move he wanted and he takes it badly — often asking to leave; turn down one he didn\'t, and he is glad', () => {
  const { world, club } = managed(82);
  const store = world.players;
  const big = world.clubs.reduce((a, b) => (b.reputation > a.reputation && b.id !== club.id ? b : a));
  let asked = 0;
  let keen = 0;
  for (const [i, p] of club.players.slice(0, 10).entries()) {
    store.morale[p] = 30;
    store.playingTime[p] = 10;
    const offer = bid(world, p, big.id, 100 + i);
    // Loyal, long-serving men may still be in two minds: it is the keen ones this is about.
    if (stanceOf(world, offer) !== 'keen') { world.incomingOffers = world.incomingOffers.filter((o) => o !== offer); continue; }
    keen++;
    world.incomingOffers = world.incomingOffers.filter((o) => o !== offer);
    bidTurnedDown(world, offer, 'declined');
    assert.ok(store.morale[p] < 30, 'he is hurt');
    if (world.transferRequests?.[p]?.status === 'open') asked++;
    else assert.ok((world.unhappyWeeks?.[p] ?? 0) >= 2, 'and unsettled if he hasn\'t asked yet');
  }
  assert.ok(keen >= 5, `${keen} of 10 keen`);
  assert.ok(asked > 0, `${asked} of ${keen} asked to leave`);

  const small = world.clubs.filter((c) => c.id !== club.id).reduce((a, b) => (b.reputation < a.reputation ? b : a));
  const happy = club.players[11];
  store.morale[happy] = 90;
  store.playingTime[happy] = 90;
  const offer = bid(world, happy, small.id, 300);
  assert.equal(stanceOf(world, offer), 'staying');
  world.incomingOffers = world.incomingOffers.filter((o) => o !== offer);
  bidTurnedDown(world, offer, 'declined');
  assert.equal(store.morale[happy], 93);
  // Agree to sell him anyway, and he most likely won't go.
  let goes = 0;
  for (let i = 0; i < 20; i++) if (stanceOnAgreedSale(world, bid(world, happy, small.id, 400 + i), true)) goes++;
  assert.ok(goes <= 8, `${goes} of 20 went`);
});

test('a player who asked to leave can change his mind once he has settled', () => {
  const { world, club } = managed(83);
  const store = world.players;
  const p = club.players[2];
  (world.transferRequests ??= {})[p] = { day: world.day, status: 'refused', reason: 'unhappy' };
  store.morale[p] = 85;
  store.playingTime[p] = 70;
  for (let w = 0; w < 40 && world.transferRequests[p] !== undefined; w++) {
    world.day += 7;
    changesOfMind(world);
  }
  assert.equal(world.transferRequests[p], undefined, 'he withdrew it');
  assert.ok(world.messages.some((m) => m.subject.includes('changes his mind')));
  // Still miserable: he doesn't.
  const q = club.players[3];
  world.transferRequests[q] = { day: world.day, status: 'refused', reason: 'unhappy' };
  store.morale[q] = 20;
  for (let w = 0; w < 20; w++) { world.day += 7; changesOfMind(world); }
  assert.equal(world.transferRequests[q]?.status, 'refused');
});

test('the staff report in: the assistant every week, the scouts before a match, and the national squad\'s club form', () => {
  const { world, club } = managed(84);
  const ctx = newSeasonContext();
  // A couple of months in, with matches played.
  for (let d = 0; d < 90; d++) advanceDay(world, ctx, { detailedClubs: new Set([club.id]) });
  const assistant = world.messages.filter((m) => m.subject.startsWith('Assistant\'s report'));
  assert.ok(assistant.length >= 8, `${assistant.length} weekly reports`);
  const scouting = world.messages.filter((m) => m.subject.startsWith('Scouting report'));
  assert.ok(scouting.length > 0);
  assert.ok(scouting.every((m) => (m.tables?.[0]?.rows.length ?? 0) > 0 || m.tables === undefined));
  // One per match, not one a day.
  assert.equal(new Set(scouting.map((m) => m.fixtureId)).size, scouting.length);

  // A national team, with or without a club.
  appointNationalCoach(world, world.players.nation[club.players[0]]);
  while (world.day % 14 !== 3) world.day++;
  nationalFormReport(world);
  const form = world.messages[world.messages.length - 1];
  assert.match(form.subject, /Club form/);
  assert.ok((form.tables?.[0]?.rows.length ?? 0) > 0, 'the squad, at their clubs');
  // And the reports keep to their days.
  const before = world.messages.length;
  world.day++;
  nationalFormReport(world);
  assistantReport(world);
  scoutingReport(world);
  assert.ok(world.messages.length - before <= 1);
});

test('the manager has his say over the post: a report switched off stops coming, a fortnightly one comes half as often', () => {
  const { world, club } = managed(85);
  const ctx = newSeasonContext();
  const count = (prefix: string): number => world.messages.filter((m) => m.subject.startsWith(prefix)).length;
  world.inboxPrefs = { assistant: 'fortnightly', scouting: false, roundups: false };
  for (let d = 0; d < 112; d++) advanceDay(world, ctx, { detailedClubs: new Set([club.id]) });
  const fortnightly = count('Assistant\'s report');
  assert.ok(fortnightly >= 6 && fortnightly <= 8, `${fortnightly} in 16 weeks`);
  assert.equal(count('Scouting report'), 0);
  assert.equal(count('Matchday'), 0);
  world.inboxPrefs = { assistant: 'off' };
  const before = count('Assistant\'s report');
  for (let d = 0; d < 28; d++) advanceDay(world, ctx, { detailedClubs: new Set([club.id]) });
  assert.equal(count('Assistant\'s report'), before);
  assert.ok(count('Scouting report') > 0, 'back on by default');
});
