import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, MatchSimulator, rotationSteps } from './engine.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';

const world = generateWorld({ seed: 7, startYear: 2026, scale: 'small', manager: stubManager() });
const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 14);

test('a side starts the set in the rotation its coach names — and a set-break sheet can start the next in another', () => {
  for (let r = 0; r < 6; r++) {
    const home = toTeamSetup(world.players, a);
    const sim = new MatchSimulator(world.players, {
      home: { ...home, startingRotation: rotationSteps(r) }, away: toTeamSetup(world.players, b),
      format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: false, seed: 5,
    });
    assert.equal(sim.snapshot().homeRotation, r, `P${r + 1}`);
    // Before the first serve, a fresh sheet may name another.
    const sheet = sim.startingLineup(0);
    assert.deepEqual(sim.setStartingLineup(0, sheet, home.libero, home.defensiveLibero ?? -1, rotationSteps((r + 2) % 6)), { ok: true });
    assert.equal(sim.snapshot().homeRotation, (r + 2) % 6, `then P${((r + 2) % 6) + 1}`);
  }
});
