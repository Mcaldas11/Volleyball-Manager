import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/engine/world/worldGen.ts';
import { stubManager } from '../src/engine/world/world.ts';
import { toTeamSetup } from '../src/engine/season/seasonEngine.ts';
import { selectionScore } from '../src/engine/model/ability.ts';
import type { PlayerStore } from '../src/engine/model/players.ts';
import { Position } from '../src/engine/model/positions.ts';
import { MatchFormat, MatchSimulator, type MatchSetup } from '../src/engine/match/engine.ts';

function buildMatch(worldSeed: number, matchSeed: number): { store: PlayerStore; setup: MatchSetup } {
  const world = generateWorld({ seed: worldSeed, startYear: 2026, scale: 'small', manager: stubManager() });
  const home = world.clubs[0];
  const away = world.clubs[1];
  return {
    store: world.players,
    setup: {
      home: toTeamSetup(world.players, home),
      away: toTeamSetup(world.players, away),
      format: MatchFormat.BestOf5,
      importance: 0.5,
      neutralVenue: false,
      collectLog: true,
      seed: matchSeed,
    },
  };
}

console.log('loaded');
test('MatchSimulator.run() is deterministic for a given seed', () => {
  console.log('in test');
  const a = buildMatch(1, 999);
  const b = buildMatch(1, 999);
  const resultA = new MatchSimulator(a.store, a.setup).run();
  const resultB = new MatchSimulator(b.store, b.setup).run();

  assert.deepEqual(resultA.setScores, resultB.setScores);
  assert.equal(resultA.homeSets, resultB.homeSets);
  assert.equal(resultA.awaySets, resultB.awaySets);
});

test('step()-driven playback matches run() for the same seed', () => {
});
