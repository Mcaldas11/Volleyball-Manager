import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../engine/world/worldGen.ts';
import { stubManager } from '../engine/world/world.ts';
import { reviveWorld } from './persistence.ts';

test('world round-trips through structuredClone with prototypes restored', () => {
  const world = generateWorld({ seed: 1, startYear: 2026, scale: 'small', manager: stubManager(3) });

  const nameBefore = world.players.fullName(0);
  world.rng.next(); // advance state so it differs from a fresh Rng
  const stateBefore = world.rng.getState();
  const nameId = world.players.names.intern('Round Trip Test');

  const revived = reviveWorld(structuredClone(world));

  // Prototype methods work again.
  assert.equal(revived.players.fullName(0), nameBefore);
  assert.equal(typeof revived.rng.next, 'function');
  assert.deepEqual(revived.rng.getState(), stateBefore);
  assert.equal(revived.players.names.get(nameId), 'Round Trip Test');

  // Plain-data structures survive natively.
  assert.ok(revived.fixturesByDay instanceof Map);
  assert.equal(revived.fixturesByDay.size, world.fixturesByDay.size);
  assert.equal(revived.clubs.length, world.clubs.length);
  assert.equal(revived.manager.firstName, 'Alex');
  assert.equal(revived.manager.nation, 3);
});
