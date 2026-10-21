import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { Position } from '../model/positions.ts';
import { NATIONS } from './nations.ts';
import { addUniquePlayers, uniquePlayerIndex } from './uniquePlayers.ts';

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
  // A save from before him.
  delete world.uniquePlayers;
  addUniquePlayers(world);
  assert.equal(world.players.count, count + 1);
  assert.equal(world.players.fullName(uniquePlayerIndex(world, 'diogo-couto')!), 'Diogo Couto');
});

test("the women's game has no place for him", () => {
  const world = generateWorld({ seed: 33, startYear: 2026, scale: 'small', manager: stubManager(), gender: 'women' });
  assert.equal(uniquePlayerIndex(world, 'diogo-couto'), undefined);
});
