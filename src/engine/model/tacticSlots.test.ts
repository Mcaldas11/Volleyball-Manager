import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Formation, formationOf, OffensiveSystem } from '../match/tactics.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import {
  activeTactic, deleteTactic, loadTactic, MAX_TACTICS, newTactic, renameTactic, tacticSlots,
} from './tacticSlots.ts';

function aClub() {
  const world = generateWorld({ seed: 71, startYear: 2026, scale: 'small', manager: stubManager() });
  return world.clubs.find((c) => c.tier === 1)!;
}

test('a club starts with its tactic saved as the first, loaded', () => {
  const club = aClub();
  const slots = tacticSlots(club);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].name, 'Tactic 1');
  assert.equal(activeTactic(club), 0);
});

test('every saved tactic remembers its system, instructions and team sheet', () => {
  const club = aClub();
  const firstSix = [...club.preferredLineup];
  assert.equal(newTactic(club), 1, 'a new one is made and loaded');
  club.tactics.formation = Formation.FourTwo;
  club.tactics.offense = OffensiveSystem.MiddleFocused;
  club.preferredLineup = [];
  renameTactic(club, 1, '  Two setters  ');

  loadTactic(club, 0);
  assert.equal(formationOf(club.tactics), Formation.FiveOne);
  assert.notEqual(club.tactics.offense, OffensiveSystem.MiddleFocused);
  assert.deepEqual(club.preferredLineup, firstSix);

  loadTactic(club, 1);
  assert.equal(formationOf(club.tactics), Formation.FourTwo);
  assert.equal(club.tactics.offense, OffensiveSystem.MiddleFocused);
  assert.deepEqual(club.preferredLineup, []);
  assert.equal(tacticSlots(club)[1].name, 'Two setters');
});

test('three at most; deleting the loaded one loads the first left, and the last can never go', () => {
  const club = aClub();
  newTactic(club);
  newTactic(club);
  assert.equal(tacticSlots(club).length, MAX_TACTICS);
  assert.equal(newTactic(club), null);
  club.tactics.formation = Formation.FourTwo;
  assert.equal(deleteTactic(club, 2), true);
  assert.equal(activeTactic(club), 0);
  assert.equal(formationOf(club.tactics), Formation.FiveOne);
  assert.equal(deleteTactic(club, 1), true);
  assert.equal(deleteTactic(club, 0), false);
  assert.equal(tacticSlots(club).length, 1);
});
