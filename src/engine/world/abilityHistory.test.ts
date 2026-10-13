import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endSeason } from '../season/rollover.ts';
import { newSeasonContext, simulateRestOfSeason, startSeason } from '../season/seasonEngine.ts';
import { abilityTimeline, HISTORY_SEASONS, recordAbilities } from './abilityHistory.ts';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';

test('every player\'s ability is kept as each season closes — the last twenty — and charted with now', () => {
  const world = generateWorld({ seed: 131, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  simulateRestOfSeason(world, ctx);
  const p = world.clubs.find((c) => c.tier === 1)!.players[0];
  const closing = world.players.currentAbility[p];
  endSeason(world, ctx);
  assert.deepEqual(world.abilityHistory?.seasons, [0]);
  assert.equal(world.abilityHistory!.values[0][p], closing, 'as the season closed, before the summer');
  const line = abilityTimeline(world, p);
  assert.deepEqual(line.map((x) => x.season), [0, 1]);
  assert.equal(line[1].now, true);
  assert.equal(line[1].ability, world.players.currentAbility[p]);

  // Once a season, and only the last twenty.
  recordAbilities(world);
  recordAbilities(world);
  for (let s = 0; s < 25; s++) { world.season++; recordAbilities(world); }
  assert.equal(world.abilityHistory!.seasons.length, HISTORY_SEASONS);
  assert.equal(new Set(world.abilityHistory!.seasons).size, HISTORY_SEASONS);
  // A player who wasn't born yet has no past.
  const count = world.players.count;
  assert.deepEqual(abilityTimeline({ ...world, abilityHistory: { seasons: [0], values: [new Uint16Array(count - 1)] } } as typeof world, count - 1).length, 1);
});
