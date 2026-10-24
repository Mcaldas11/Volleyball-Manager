import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { clubNumbers, setShirtNumber, shirtNumberOf } from './squadNumbers.ts';

test('every player at a club wears a number of his own, from 1 to 99', () => {
  const world = generateWorld({ seed: 71, startYear: 2026, scale: 'small', manager: stubManager() });
  for (const club of world.clubs.filter((c) => c.players.length > 0).slice(0, 20)) {
    const numbers = [...clubNumbers(world, club).values()];
    assert.equal(numbers.length, club.players.length);
    assert.equal(new Set(numbers).size, numbers.length, `${club.name}: no number worn twice`);
    assert.ok(numbers.every((n) => n >= 1 && n <= 99));
  }
});

test('the manager picks a number; a team-mate wearing it swaps with him; a newcomer gives way', () => {
  const world = generateWorld({ seed: 72, startYear: 2026, scale: 'small', manager: stubManager() });
  const club = world.clubs.find((c) => c.players.length >= 12)!;
  const [a, b] = club.players;
  const na = shirtNumberOf(world, a)!;
  const nb = shirtNumberOf(world, b)!;
  assert.ok(setShirtNumber(world, club, a, 77).ok);
  assert.equal(shirtNumberOf(world, a), 77);
  // Giving a the number b wears: b takes 77.
  assert.ok(setShirtNumber(world, club, a, nb).ok);
  assert.equal(shirtNumberOf(world, a), nb);
  assert.equal(shirtNumberOf(world, b), 77);
  assert.notEqual(na, -1);
  assert.equal(setShirtNumber(world, club, a, 0).ok, false);
  assert.equal(setShirtNumber(world, club, a, 100).ok, false);
  // A player from elsewhere who wears the same number as one here gives way when he joins.
  const other = world.clubs.find((c) => c.id !== club.id && c.players.length > 0)!;
  const newcomer = other.players[0];
  (world.shirtNumbers ??= {})[newcomer] = nb;
  other.players = other.players.filter((p) => p !== newcomer);
  club.players.push(newcomer);
  world.players.clubId[newcomer] = club.id;
  assert.equal(shirtNumberOf(world, a), nb, 'the man here keeps it');
  assert.notEqual(shirtNumberOf(world, newcomer), nb);
  const all = [...clubNumbers(world, club).values()];
  assert.equal(new Set(all).size, all.length);
});
