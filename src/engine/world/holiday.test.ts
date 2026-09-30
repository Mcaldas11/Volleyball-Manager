import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerFlag } from '../model/players.ts';
import { newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { appointManager } from './career.ts';
import { answerOffers, applyForJobs, countHolidayDay, holidayDays, returnDay } from './holiday.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';

function managed(seed: number): World {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  startSeason(world, newSeasonContext());
  appointManager(world, world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id);
  return world;
}

/** Four bids for the manager's players: over and under value, listed and not, plus a loan. */
function bids(world: World): { over: number; under: number; listedUnder: number; loan: number } {
  const club = world.clubs[world.userClubId];
  const store = world.players;
  const [a, b, c, d] = club.players;
  store.setFlag(c, PlayerFlag.Transferable, true);
  world.incomingOffers = [];
  const offer = (id: number, playerIdx: number, fee: number, loan = false): void => {
    world.incomingOffers.push({
      id, playerIdx, buyingClubId: club.id === 0 ? 1 : 0, fee, expiresOnDay: world.day + 10, status: 'open',
      ...(loan ? { loan: { wageShare: 0.5 } } : {}),
    });
  };
  offer(1, a, store.value[a] + 1000);
  offer(2, b, Math.max(0, store.value[b] - 1000));
  offer(3, c, Math.max(0, store.value[c] - 1000));
  offer(4, d, 0, true);
  return { over: 1, under: 2, listedUnder: 3, loan: 4 };
}

const statusOf = (world: World, id: number): string =>
  world.incomingOffers.find((o) => o.id === id)?.status ?? 'declined';

test('turning bids down while away leaves none waiting', () => {
  const world = managed(101);
  bids(world);
  assert.deepEqual(answerOffers(world, 'reject', false), { accepted: 0, declined: 4 });
  assert.equal(world.incomingOffers.length, 0);
});

test('taking only bids at the player\'s value lets the rest go', () => {
  const world = managed(102);
  const ids = bids(world);
  answerOffers(world, 'acceptValue', false);
  assert.equal(statusOf(world, ids.over), 'accepted');
  assert.equal(statusOf(world, ids.under), 'declined');
  assert.equal(statusOf(world, ids.listedUnder), 'declined');
  assert.equal(statusOf(world, ids.loan), 'declined', 'a player not listed for loan stays');
});

test('taking every bid, but only for players on the transfer list', () => {
  const world = managed(103);
  const ids = bids(world);
  answerOffers(world, 'acceptAll', true);
  assert.equal(statusOf(world, ids.listedUnder), 'accepted');
  assert.equal(statusOf(world, ids.over), 'declined', 'not on the list, not for sale');
  assert.equal(statusOf(world, ids.loan), 'declined');
});

test('bids already in motion are left to run their course', () => {
  const world = managed(104);
  bids(world);
  world.incomingOffers[0].status = 'countered';
  answerOffers(world, 'reject', false);
  assert.equal(world.incomingOffers.length, 1);
  assert.equal(world.incomingOffers[0].status, 'countered');
});

test('applications go out to the vacancies that fit, and only once each', () => {
  const world = managed(105);
  const own = world.clubs[world.userClubId];
  const others = world.clubs.filter((c) => c.id !== own.id && c.players.length > 0);
  world.vacancies = others.slice(0, 6).map((c) => ({ clubId: c.id, since: world.day, fillsOn: world.day + 60 }));
  const top = world.vacancies.filter((v) => world.clubs[v.clubId].tier === 1).length;
  assert.equal(applyForJobs(world, 'topDivision'), top);
  assert.ok(world.career.applications.every((a) => world.clubs[a.clubId].tier === 1));
  const rest = applyForJobs(world, 'any');
  assert.equal(rest, world.vacancies.length - top, 'the others now, and none twice');
  assert.equal(applyForJobs(world, 'any'), 0);
});

test('days away are counted season by season, and a return date is where it lands', () => {
  const world = managed(106);
  assert.equal(holidayDays(world), 0);
  countHolidayDay(world);
  countHolidayDay(world);
  assert.equal(holidayDays(world), 2);
  world.season++;
  assert.equal(holidayDays(world), 0, 'a new season starts afresh');
  assert.equal(returnDay(world, { kind: 'days', days: 10 }), world.day + 10);
  assert.equal(returnDay(world, { kind: 'date', day: world.day + 3 }), world.day + 3);
  assert.equal(returnDay(world, { kind: 'indefinite' }), null);
});
