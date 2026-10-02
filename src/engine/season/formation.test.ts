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

test('in a 4-2 both setters set — whoever is in the front row — and neither attacks', () => {
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
    assert.equal(line.attacksTotal, 0, 'a setter in a 4-2 does not hit');
  }
});
