import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, stubManager, type World } from './world.ts';
import {
  injuryDuration, messageNeedsAction, messageSender, monthLabel, postMessage, welcomeMessages,
} from './inbox.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';

function career(seed: number): World {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  world.userClubId = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id;
  return world;
}

test('month labels follow the calendar from 1 July', () => {
  const w = { startYear: 2026 };
  assert.equal(monthLabel(w, 0, 0), 'July 2026');
  assert.equal(monthLabel(w, 0, 30), 'July 2026');
  assert.equal(monthLabel(w, 0, 31), 'August 2026');
  assert.equal(monthLabel(w, 0, 183), 'December 2026');
  assert.equal(monthLabel(w, 0, 184), 'January 2027');
  assert.equal(monthLabel(w, 1, 364), 'June 2028');
});

test('the finance office sends a statement on the first of every month', () => {
  const world = career(41);
  const ctx = newSeasonContext();
  while (world.day < 63) advanceDay(world, ctx);
  const statements = world.messages.filter((m) => m.statement !== undefined);
  assert.deepEqual(statements.map((m) => m.statement!.month), ['July 2026', 'August 2026']);
  assert.equal(statements[0].statement!.opening, null, 'the first statement has nothing to compare with');
  assert.equal(statements[1].statement!.opening, statements[0].statement!.balance);
  assert.ok(statements.every((m) => m.category === 'finance' && messageSender(m) === 'Finance Office'));
});

test('each league round is rounded up once, after its last match', () => {
  const world = career(42);
  const ctx = newSeasonContext();
  while (world.day < 120) advanceDay(world, ctx);
  const comp = world.competitions[world.clubs[world.userClubId].leagueId];
  const played = new Set(comp.fixtureIds.map((id) => world.fixtures[id]).filter((f) => f.played).map((f) => f.round));
  const roundups = world.messages.filter((m) => m.roundup !== undefined);
  assert.ok(roundups.length > 0, 'the season has started');
  assert.deepEqual(roundups.map((m) => m.roundup!.round), [...played].sort((a, b) => a - b));
  for (const m of roundups) {
    assert.equal(m.roundup!.competitionId, comp.id);
    assert.equal(m.roundup!.table.length, comp.participants.length);
    assert.equal(m.category, 'matchday');
  }
});

test('injuries to the user\'s players reach the inbox, and so does the recovery', () => {
  const world = career(43);
  const ctx = newSeasonContext();
  let injured = -1;
  while (world.day < DAYS_PER_SEASON / 2 && injured < 0) {
    advanceDay(world, ctx);
    injured = world.messages.find((m) => m.injury !== undefined)?.playerIdx ?? -1;
  }
  assert.ok(injured >= 0, 'someone got hurt in half a season');
  assert.equal(world.players.clubId[injured], world.userClubId);
  while (world.players.injuryDaysLeft[injured] > 0) advanceDay(world, ctx);
  const back = world.messages.filter((m) => m.category === 'medical' && m.injury === undefined && m.playerIdx === injured);
  assert.equal(back.length, 1);
});

test('a bid needs an answer until it is settled', () => {
  const world = career(44);
  const club = world.clubs[world.userClubId];
  const buyer = world.clubs.find((c) => c.id !== club.id)!;
  world.incomingOffers.push({
    id: 7, playerIdx: club.players[0], buyingClubId: buyer.id, fee: 100_000, expiresOnDay: 20, status: 'open',
  });
  const m = postMessage(world, { subject: 'Offer', body: '', offerId: 7, category: 'offer' });
  assert.equal(messageNeedsAction(world, m), true);
  world.incomingOffers[0].status = 'accepted';
  assert.equal(messageNeedsAction(world, m), false);
  world.incomingOffers = [];
  assert.equal(messageNeedsAction(world, m), false);
});

test('the board welcomes a new manager with its expectations and budgets', () => {
  const world = career(45);
  welcomeMessages(world);
  const m = world.messages[world.messages.length - 1];
  assert.equal(m.category, 'board');
  assert.equal(messageSender(m), 'Board of Directors');
  assert.match(m.body, /expect a finish/);
});

test('injury lengths read naturally', () => {
  assert.equal(injuryDuration(1), '1 day');
  assert.equal(injuryDuration(5), '5 days');
  assert.equal(injuryDuration(14), 'about 2 weeks');
  assert.equal(injuryDuration(90), 'about 3 months');
});
