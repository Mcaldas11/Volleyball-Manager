import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { addFixture, stubManager } from './world.ts';
import { appointManager } from './career.ts';
import { MatchFormat } from '../match/engine.ts';
import { bondOf, bookCamp, campBlock, campCost, campDay, campWindow, CAMP_DAYS } from './camp.ts';
import { dressingRoom } from './dressingRoom.ts';

function preseason() {
  const world = generateWorld({ seed: 44, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[2];
  appointManager(world, club.id);
  club.finances.balance = 5_000_000;
  return { world, club };
}

test('a camp is booked in the pre-season for a week clear of matches, paid for up front, once a summer', () => {
  const { world, club } = preseason();
  const w = campWindow(world)!;
  assert.ok(w !== null && w.last > w.first);
  // A week with a match in it won't do.
  const other = world.clubs.find((c) => c.id !== club.id)!;
  addFixture(world, {
    id: world.fixtures.length, competitionId: 0, day: w.first + 2, home: club.id, away: other.id, round: 0, format: MatchFormat.BestOf3,
    importance: 0.1, neutralVenue: false, played: false, homeSets: 0, awaySets: 0, setScores: [], mvp: -1,
  });
  assert.match(campBlock(world, club, 'abroad', w.first)!, /match/);
  const start = w.first + 5;
  const balance = club.finances.balance;
  assert.match(bookCamp(world, club, 'abroad', start), /Booked/);
  assert.equal(club.finances.balance, balance - campCost(club, 'abroad'));
  assert.match(campBlock(world, club, 'home', start + 10)!, /already/);
  assert.ok(campCost(club, 'abroad') > campCost(club, 'altitude') && campCost(club, 'altitude') > campCost(club, 'home'));
});

test('back from abroad the squad is in high spirits and the room tighter — fading over the autumn', () => {
  const { world, club } = preseason();
  const w = campWindow(world)!;
  const before = dressingRoom(world, club).cohesion;
  const morale = club.players.map((p) => world.players.morale[p]);
  bookCamp(world, club, 'abroad', w.first);
  world.day = w.first + CAMP_DAYS - 1;
  campDay(world);
  assert.ok(dressingRoom(world, club).cohesion > before, 'tighter');
  club.players.forEach((p, i) => assert.ok(world.players.morale[p] >= Math.min(100, morale[i])));
  assert.match(world.messages.at(-1)!.subject, /camp/);
  const fresh = bondOf(world, club.id);
  world.day += 60;
  assert.ok(bondOf(world, club.id) < fresh && bondOf(world, club.id) > 0);
  world.day += 60;
  assert.equal(bondOf(world, club.id), 0);
});

test('at altitude the young players come back with more in their legs — and everyone tired', () => {
  const { world, club } = preseason();
  const w = campWindow(world)!;
  const store = world.players;
  const stamina = club.players.map((p) => store.getAttr(p, 'stamina'));
  const condition = club.players.map((p) => store.condition[p]);
  bookCamp(world, club, 'altitude', w.first);
  world.day = w.first + CAMP_DAYS - 1;
  campDay(world);
  const gained = club.players.filter((p, i) => store.getAttr(p, 'stamina') > stamina[i]);
  assert.ok(gained.length >= 1, 'some stronger');
  assert.ok(gained.every((p) => store.ageOn(p, world.year, 181) <= 25), 'only the young');
  assert.ok(club.players.every((p, i) => store.condition[p] <= condition[i]), 'tired');
});
