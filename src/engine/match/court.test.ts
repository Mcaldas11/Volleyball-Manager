import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectivePlayerAt } from './court.ts';
import { MatchFormat, MatchSimulator } from './engine.ts';
import { Position } from '../model/positions.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { toTeamSetup } from '../season/seasonEngine.ts';

const { Setter: S, OutsideHitter: OH, MiddleBlocker: MB, Opposite: OPP, Libero: L } = Position;

test('the libero takes a back-row middle\'s place — in zone 1 too, the moment his side is not serving', () => {
  // Players 0-5 on court, 6 the libero; the middle (2) in zone 1.
  const positions = [S, OH, MB, OPP, OH, MB, L];
  const court = [2, 3, 5, 0, 1, 4];
  assert.equal(effectivePlayerAt(court, 0, positions, 6, true), 2, 'serving: the middle serves for himself');
  assert.equal(effectivePlayerAt(court, 0, positions, 6, false), 6, 'serve lost: the libero comes straight on');
  assert.equal(effectivePlayerAt(court, 2, positions, 6, false), 5, 'the middle at the net stays');
  // Rotated round, the middle in zone 6 and zone 5: the libero, serving or not.
  for (const z of [4, 5]) {
    const c = [0, 1, 3, 4, 1, 1];
    c[z] = 2;
    assert.equal(effectivePlayerAt(c, z, positions, 6, true), 6);
    assert.equal(effectivePlayerAt(c, z, positions, 6, false), 6);
  }
  // An odd lineup with both middles in the back row: the libero replaces one of them.
  const odd = [2, 0, 1, 3, 4, 5];
  const on = odd.map((_, z) => effectivePlayerAt(odd, z, positions, 6, false));
  assert.equal(on.filter((p) => p === 6).length, 1);
});

test('in a match, a middle in zone 1 serves while his side has the serve and is off for the libero once it is lost', () => {
  const world = generateWorld({ seed: 31, startYear: 2026, scale: 'small', manager: stubManager() });
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12);
  let served = 0;
  let sittingOut = 0;
  for (const seed of [1, 2, 3]) {
    const sim = new MatchSimulator(world.players, {
      home: toTeamSetup(world.players, a), away: toTeamSetup(world.players, b),
      format: MatchFormat.BestOf5, importance: 0.5, neutralVenue: true, collectLog: true, seed,
    });
    for (;;) {
      const snap = sim.snapshot();
      if (snap.matchOver) break;
      const entry = sim.step();
      if (entry === null) break;
      const courts = [snap.homeCourt, snap.awayCourt];
      const server = courts[snap.serving][0];
      if (sim.roles[server] === MB) {
        served++;
        assert.equal(entry.contacts[0]?.player, server, 'a middle in zone 1 serves');
      }
      const receiver = courts[1 - snap.serving][0];
      if (sim.roles[receiver] === MB) {
        sittingOut++;
        assert.ok(entry.contacts.every((c) => c.player !== receiver), 'a middle in zone 1 not serving is off the floor');
      }
    }
  }
  assert.ok(served > 20 && sittingOut > 20, `both happen: ${served} served, ${sittingOut} sat out`);
});
