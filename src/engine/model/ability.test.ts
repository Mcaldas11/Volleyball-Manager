import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestByAbility } from './ability.ts';

test('the best by ability: what sorting them all would give, ties in the order they came', () => {
  let seed = 7;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let t = 0; t < 500; t++) {
    // Now and then only a few levels, so that many are level on the cut.
    const levels = t % 3 === 0 ? 4 : 2000;
    const ability = Uint16Array.from({ length: 300 }, () => Math.floor(random() * levels));
    const players = [...ability.keys()].filter(() => random() < 0.7);
    for (const limit of [0, 1, 10, 150, 400]) {
      const sorted = [...players].sort((a, b) => ability[b] - ability[a]).slice(0, limit);
      assert.deepEqual(bestByAbility(players, ability, limit), sorted);
    }
  }
  assert.deepEqual(bestByAbility([], new Uint16Array(0), 5), []);
});
