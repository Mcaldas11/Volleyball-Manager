import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectedGate } from './commercial.ts';
import {
  arenaDay, expansionBlock, expansionOptions, fanFactor, fansAfterMatch, fansOf, fansSigning, fansTrophy, requestExpansion,
  supportersWeek,
} from './supporters.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager, type Fixture, type World } from './world.ts';

function setup(seed: number): { world: World; club: World['clubs'][number] } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!;
  world.userClubId = club.id;
  return { world, club };
}

test('a following grows with wins, trophies and stars — and a bigger one fills the arena and sells the shirts', () => {
  const { world, club } = setup(151);
  const start = fansOf(club);
  assert.equal(start, club.arenaCapacity * 3, 'three for every seat to begin with');
  assert.equal(fanFactor(club), 1);
  const crowd = projectedGate(world, club).crowd;
  const merch = club.finances.merchandiseIncome;

  const rival = world.clubs.find((c) => c.id !== club.id && c.nation === club.nation)!;
  const won = { home: club.id, away: rival.id, homeSets: 3, awaySets: 1, competitionId: club.leagueId } as unknown as Fixture;
  for (let i = 0; i < 10; i++) fansAfterMatch(world, won);
  assert.ok(fansOf(club) > start && fansOf(rival) < rival.arenaCapacity * 3);
  fansTrophy(world, club.id);
  const star = [...club.players].sort((a, b) => world.players.currentAbility[b] - world.players.currentAbility[a])[0];
  const before = fansOf(club);
  fansSigning(world, club, star);
  assert.ok(fansOf(club) > before);
  assert.ok(world.messages.some((m) => m.subject.endsWith('shirts sell out')));
  supportersWeek(world);
  assert.ok(fanFactor(club) > 1);
  assert.ok(projectedGate(world, club).crowd > crowd || projectedGate(world, club).crowd === club.arenaCapacity, 'more come');
  assert.ok(club.finances.merchandiseIncome > merch, 'and buy the shirts');

  // Left alone, it drifts back towards what the club's standing draws.
  for (let w = 0; w < 400; w++) supportersWeek(world);
  assert.ok(Math.abs(fanFactor(club) - 1) < 0.03);
});

test('a new stand: the board pays if it can and trusts the manager; months later the arena is bigger, at the same takings a seat', () => {
  const { world, club } = setup(152);
  const [small] = expansionOptions(club);
  club.finances.balance = small.cost * 2;
  club.boardConfidence = 70;
  const seats = club.arenaCapacity;
  const perSeat = club.finances.ticketIncomePerMatch / seats;
  assert.match(requestExpansion(world, club, small.seats), /is with the board/);
  assert.ok(expansionBlock(world, club) !== null, 'one at a time');
  for (let d = 0; d < 10 && club.arenaProject?.stage === 'asked'; d++) { world.day++; arenaDay(world); }
  assert.equal(club.arenaProject?.stage, 'building');
  assert.equal(club.finances.balance, small.cost, 'paid up front');
  for (let d = 0; d < 400 && club.arenaProject !== undefined; d++) { world.day++; arenaDay(world); }
  assert.equal(club.arenaCapacity, seats + small.seats);
  assert.ok(Math.abs(club.finances.ticketIncomePerMatch / club.arenaCapacity - perSeat) < 1);
  assert.ok(world.messages.some((m) => m.subject === 'The new stand opens'));

  // No money, no stand — and not again for a while.
  club.finances.balance = 0;
  requestExpansion(world, club, expansionOptions(club)[0].seats);
  for (let d = 0; d < 10 && club.arenaProject !== undefined; d++) { world.day++; arenaDay(world); }
  assert.ok(world.messages.some((m) => m.subject === 'New stand turned down'));
  assert.match(expansionBlock(world, club)!, /ask again/);
});
