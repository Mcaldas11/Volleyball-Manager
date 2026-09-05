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

test('substitute() enforces the five-per-set limit', () => {
  const { store, setup } = buildMatch(5, 333);
  assert.ok(setup.home.bench.length >= 6, 'this test needs at least 6 bench players');
  const sim = new MatchSimulator(store, setup);
  sim.step();

  for (let i = 0; i < 5; i++) {
    const outPlayer = setup.home.lineup[i];
    const inPlayer = setup.home.bench[i];
    const result = sim.substitute(0, outPlayer, inPlayer);
    assert.equal(result.ok, true, `substitution ${i} should succeed`);
  }

  // Zone 5 was never touched by the loop above, so this is a fresh pair —
  // it should still fail, but purely on the count limit, not the pairing rule.
  const sixthOut = sim.snapshot().homeCourt[5];
  const sixthIn = setup.home.bench[5];
  const sixth = sim.substitute(0, sixthOut, sixthIn);
  assert.equal(sixth.ok, false);
  assert.equal(sim.subsRemaining(0), 0);
});

test('substitute() only lets a substituted starter return for the player who replaced them', () => {
  const { store, setup } = buildMatch(6, 444);
  assert.ok(setup.home.bench.length >= 2, 'this test needs at least 2 bench players');
  const sim = new MatchSimulator(store, setup);
  sim.step();

  const starter = setup.home.lineup[0];
  const sub1 = setup.home.bench[0];
  const sub2 = setup.home.bench[1];

  assert.equal(sim.substitute(0, starter, sub1).ok, true);

  // A different bench player may not come in for sub1 — only the starter may.
  assert.equal(sim.substitute(0, sub1, sub2).ok, false);

  // The starter returning for sub1 (their own replacement) is fine.
  assert.equal(sim.substitute(0, sub1, starter).ok, true);
  assert.ok(sim.snapshot().homeCourt.includes(starter));

  // The pair is locked for the rest of the set: sub2 still can't break in...
  assert.equal(sim.substitute(0, starter, sub2).ok, false);
  // ...only sub1 can replace the starter again.
  assert.equal(sim.substitute(0, starter, sub1).ok, true);
});
