import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchFormat, simulateMatch } from '../match/engine.ts';
import { Formation } from '../match/tactics.ts';
import { Position } from '../model/positions.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import { LINEUP_SLOT_POSITIONS_42, pickLineup, toTeamSetup } from './seasonEngine.ts';

function twoClubs(seed: number) {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const [a, b] = world.clubs.filter((c) => c.tier === 1 && c.players.filter((p) => world.players.position[p] === Position.Setter).length >= 2);
  return { world, a, b };
}

test('a 4-2 starts two setters diagonal, where a 5-1 has a setter and an opposite', () => {
  const { world, a } = twoClubs(61);
  const store = world.players;
  const fiveOne = pickLineup(store, a);
  assert.equal(store.position[fiveOne.lineup[0]], Position.Setter);
  assert.equal(store.position[fiveOne.lineup[3]], Position.Opposite);
  a.tactics.formation = Formation.FourTwo;
  const fourTwo = pickLineup(store, a);
  assert.deepEqual(fourTwo.lineup.map((p) => store.position[p]), [...LINEUP_SLOT_POSITIONS_42]);
});

test('in a 4-2 both setters set — from the back row — and both attack, from the front', () => {
  const { world, a, b } = twoClubs(62);
  const store = world.players;
  a.tactics.formation = Formation.FourTwo;
  const home = toTeamSetup(store, a);
  const result = simulateMatch(store, {
    home, away: toTeamSetup(store, b), format: MatchFormat.BestOf5, importance: 0.5,
    neutralVenue: false, collectLog: false, seed: 9,
  });
  const setters = [home.lineup[0], home.lineup[3]];
  for (const s of setters) {
    const line = result.stats.home.players.get(s);
    assert.ok(line !== undefined && line.setsMade > 20, 'each sets a share of the match');
    assert.ok(line.attacksTotal > 3, 'and hits on the right when at the net');
  }
});

/** Every second touch of a match, with the first touch before it. */
function secondTouches(seed: number, formation: Formation) {
  const { world, a, b } = twoClubs(seed);
  const store = world.players;
  a.tactics.formation = formation;
  const home = toTeamSetup(store, a);
  const result = simulateMatch(store, {
    home, away: toTeamSetup(store, b), format: MatchFormat.BestOf5, importance: 0.5,
    neutralVenue: false, collectLog: true, seed: 11,
  });
  const pairs: Array<{ first: number; second: number; quality: number }> = [];
  for (const r of result.log ?? []) {
    let first = -1;
    let quality = 1;
    for (const c of r.contacts) {
      if (c.team !== 0) continue;
      if (c.kind === 'reception' || c.kind === 'dig') { first = c.player; quality = c.quality ?? 1; }
      if ((c.kind === 'set' || c.kind === 'setError') && first >= 0) { pairs.push({ first, second: c.player, quality }); first = -1; }
    }
  }
  return { store, home, pairs };
}

test('nobody plays the ball twice: when the setter digs in a 5-1, the libero sets — and on a bad ball he often does', () => {
  const { store, home, pairs } = secondTouches(63, Formation.FiveOne);
  assert.ok(pairs.every((x) => x.first !== x.second), 'never the same player twice');
  const setter = home.lineup[0];
  const afterSetter = pairs.filter((x) => x.first === setter);
  assert.ok(afterSetter.length > 0, 'the setter dug or passed some balls');
  assert.ok(afterSetter.every((x) => store.position[x.second] === Position.Libero || x.second !== setter));
  assert.ok(afterSetter.some((x) => store.position[x.second] === Position.Libero), 'the libero took his place');
  const badBalls = pairs.filter((x) => x.quality < 0.22 && x.first !== home.libero);
  assert.ok(badBalls.some((x) => x.second === home.libero), 'the libero chases a bad ball');
});

test('in a 4-2, when one setter plays the first ball, the other sets', () => {
  const { store, home, pairs } = secondTouches(64, Formation.FourTwo);
  const setters = new Set([home.lineup[0], home.lineup[3]]);
  const afterSetter = pairs.filter((x) => setters.has(x.first));
  assert.ok(afterSetter.length > 0, 'a setter dug or passed some balls');
  assert.ok(afterSetter.every((x) => x.second !== x.first));
  assert.ok(afterSetter.filter((x) => store.position[x.second] === Position.Setter).length >= afterSetter.length * 0.7,
    'mostly the other setter');
});
