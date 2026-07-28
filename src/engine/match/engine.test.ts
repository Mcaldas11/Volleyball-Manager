import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';
import type { PlayerStore } from '../model/players.ts';
import { MatchFormat, MatchSimulator, type MatchSetup } from './engine.ts';

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

test('MatchSimulator.run() is deterministic for a given seed', () => {
  const a = buildMatch(1, 999);
  const b = buildMatch(1, 999);
  const resultA = new MatchSimulator(a.store, a.setup).run();
  const resultB = new MatchSimulator(b.store, b.setup).run();

  assert.deepEqual(resultA.setScores, resultB.setScores);
  assert.equal(resultA.homeSets, resultB.homeSets);
  assert.equal(resultA.awaySets, resultB.awaySets);
});

test('step()-driven playback matches run() for the same seed', () => {
  const a = buildMatch(2, 555);
  const b = buildMatch(2, 555);
  const viaRun = new MatchSimulator(a.store, a.setup).run();

  const stepped = new MatchSimulator(b.store, b.setup);
  while (stepped.step() !== null) { /* drain one rally at a time */ }
  const viaStep = stepped.buildResult();

  assert.deepEqual(viaStep.setScores, viaRun.setScores);
  assert.equal(viaStep.homeSets, viaRun.homeSets);
  assert.equal(viaStep.awaySets, viaRun.awaySets);
});

test('substitute() swaps the bench player into the correct zone', () => {
  const { store, setup } = buildMatch(3, 111);
  const sim = new MatchSimulator(store, setup);
  sim.step(); // starts the match

  const outPlayer = setup.home.lineup[0];
  const inPlayer = setup.home.bench[0];
  const result = sim.substitute(0, outPlayer, inPlayer);

  assert.equal(result.ok, true);
  const snap = sim.snapshot();
  assert.ok(snap.homeCourt.includes(inPlayer));
  assert.ok(!snap.homeCourt.includes(outPlayer));
});

test('substitute() rejects a player outside the squad', () => {
  const { store, setup } = buildMatch(4, 222);
  const sim = new MatchSimulator(store, setup);
  sim.step();

  const outPlayer = setup.home.lineup[0];
  const result = sim.substitute(0, outPlayer, 999_999);
  assert.equal(result.ok, false);
});

test('substitute() enforces the six-per-set limit', () => {
  const { store, setup } = buildMatch(5, 333);
  assert.ok(setup.home.bench.length >= 7, 'this test needs at least 7 bench players');
  const sim = new MatchSimulator(store, setup);
  sim.step();

  for (let i = 0; i < 6; i++) {
    const outPlayer = setup.home.lineup[i];
    const inPlayer = setup.home.bench[i];
    const result = sim.substitute(0, outPlayer, inPlayer);
    assert.equal(result.ok, true, `substitution ${i} should succeed`);
  }

  const seventhOut = sim.snapshot().homeCourt[0];
  const seventhIn = setup.home.bench[6];
  const seventh = sim.substitute(0, seventhOut, seventhIn);
  assert.equal(seventh.ok, false);
  assert.equal(sim.subsRemaining(0), 0);
});
