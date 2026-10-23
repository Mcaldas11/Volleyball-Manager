import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { Position } from '../model/positions.ts';
import { NATIONS } from './nations.ts';
import { addUniquePlayers, uniquePlayerIndex } from './uniquePlayers.ts';
import { PlayerFlag } from '../model/players.ts';
import { DAYS_PER_SEASON } from './world.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { endSeason } from '../season/rollover.ts';

test('Diogo Couto is in every new world: a Portuguese libero who can play outside, a free agent', () => {
  const world = generateWorld({ seed: 31, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const p = uniquePlayerIndex(world, 'diogo-couto')!;
  assert.ok(p !== undefined);
  assert.equal(store.fullName(p), 'Diogo Couto');
  assert.equal(NATIONS[store.nation[p]].code, 'POR');
  assert.equal(store.heightCm[p], 184);
  assert.equal(store.birthYear[p], 2005);
  assert.equal(store.ageOn(p, 2026, 174), 21, 'his birthday, 24 June');
  assert.equal(store.ageOn(p, 2026, 173), 20, 'the day before it');
  assert.equal(store.position[p], Position.Libero);
  assert.equal(store.secondary[p], Position.OutsideHitter);
  assert.equal(store.familiarity[p * 5 + Position.OutsideHitter], 100);
  assert.equal(store.clubId[p], -1, 'without a club');
  assert.ok(store.isActive(p));
  assert.ok(store.currentAbility[p] >= 1500, 'one of the best liberos about');
  assert.ok(store.potentialAbility[p] > store.currentAbility[p]);
});

test('a saved world gets him once, and only once', () => {
  const world = generateWorld({ seed: 32, startYear: 2026, scale: 'small', manager: stubManager() });
  const count = world.players.count;
  addUniquePlayers(world);
  assert.equal(world.players.count, count, 'already there: not added again');
  // A save from before them.
  delete world.uniquePlayers;
  addUniquePlayers(world);
  assert.equal(world.players.count, count + 2);
  assert.equal(world.players.fullName(uniquePlayerIndex(world, 'diogo-couto')!), 'Diogo Couto');
  assert.equal(world.players.fullName(uniquePlayerIndex(world, 'matthew-lienert')!), 'Matthew Lienert');
});

test('Matthew Lienert: an Australian opposite of twelve, as good with either hand, still growing — and no club signs him yet', () => {
  const world = generateWorld({ seed: 34, startYear: 2026, scale: 'small', manager: stubManager() });
  const store = world.players;
  const p = uniquePlayerIndex(world, 'matthew-lienert')!;
  assert.ok(p !== undefined);
  assert.equal(store.fullName(p), 'Matthew Lienert');
  assert.equal(NATIONS[store.nation[p]].code, 'AUS');
  assert.equal(store.ageOn(p, 2026, 181), 12);
  assert.equal(store.ageOn(p, 2027, 56), 13, 'his birthday, 26 February');
  assert.equal(store.ageOn(p, 2027, 55), 12, 'the day before it');
  assert.equal(store.heightCm[p], 185);
  assert.equal(store.offHand[p], 20);
  assert.equal(store.position[p], Position.Opposite);
  assert.equal(store.clubId[p], -1);
  assert.ok(!store.hasFlag(p, PlayerFlag.Youth), 'a free agent the manager can find, not an academy boy');
  assert.equal(store.potentialAbility[p], 1870, 'a long way still to go');

  // Summer by summer he grows into his 2.01 m — and nobody signs him before he is sixteen.
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const heights = [store.heightCm[p]];
  for (let s = 0; s < 3; s++) {
    while (world.day < (world.season + 1) * DAYS_PER_SEASON - 1) advanceDay(world, ctx, {});
    endSeason(world, ctx);
    startSeason(world, ctx);
    heights.push(store.heightCm[p]);
    assert.equal(store.clubId[p], -1, `still unattached at ${store.ageOn(p, world.year, 181)}`);
  }
  for (let k = 1; k < heights.length; k++) assert.ok(heights[k] > heights[k - 1], `${heights.join(' → ')}`);
  assert.ok(heights[3] < 201);
});

test("the women's game has no place for him", () => {
  const world = generateWorld({ seed: 33, startYear: 2026, scale: 'small', manager: stubManager(), gender: 'women' });
  assert.equal(uniquePlayerIndex(world, 'diogo-couto'), undefined);
});
