import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockFocus, BlockNumbers, Formation, OffensiveSystem, Tempo } from '../match/tactics.ts';
import { NEW_TACTIC_FAMILIARITY } from '../match/tacticFamiliarity.ts';
import { generateWorld } from '../world/worldGen.ts';
import { stubManager } from '../world/world.ts';
import {
  parseTacticFile, serialiseTacticFile, TACTIC_FILE_FORMAT, tacticFileName, tacticFromFile, tacticToFile,
} from './tacticFile.ts';
import { activeTactic, addTactic, MAX_TACTICS, newTactic, saveLoadedTactic, tacticSlots } from './tacticSlots.ts';

function aWorld() {
  const world = generateWorld({ seed: 71, startYear: 2026, scale: 'small', manager: stubManager() });
  const clubs = world.clubs.filter((c) => c.tier === 1);
  return { world, club: clubs[0], other: clubs[1] };
}

/** A club's loaded tactic, set up with a bit of everything a file has to carry. */
function aTactic() {
  const { world, club, other } = aWorld();
  const t = club.tactics;
  t.formation = Formation.FiveOne;
  t.offense = OffensiveSystem.PipeHeavy;
  t.tempo = Tempo.Fast;
  t.rotations[2].play = 'scissors';
  t.rotations[4].receivers = 2;
  t.rotations[1].setterTempoBias = 80;
  t.blockPlans = {
    outside: { focus: BlockFocus.Line, numbers: BlockNumbers.Triple },
    opposite: { focus: BlockFocus.Read, numbers: BlockNumbers.Double, spots: [0.3, -0.4, -1.1] },
    pipe: { focus: BlockFocus.Cross, numbers: BlockNumbers.Single },
  };
  const server = club.players[0];
  t.servers = { [server]: { style: 'jumpFloat', zone: 5 } };
  club.preferredLineup = club.players.slice(0, 6);
  club.preferredFormation = Formation.FiveOne;
  saveLoadedTactic(club);
  return { world, club, other, server, slot: tacticSlots(club)[activeTactic(club)] };
}

test('a tactic survives the round trip to a file and back, at its own club', () => {
  const { world, club, server, slot } = aTactic();
  const text = serialiseTacticFile(tacticToFile(slot, world.players, club.name));
  const read = parseTacticFile(text);
  assert.ok(read.ok);
  assert.deepEqual(read.warnings, []);
  assert.equal(read.file.name, slot.name);
  assert.equal(read.file.club, club.name);

  const { tactic, found, named } = tacticFromFile(read.file, club.players, world.players);
  assert.equal(found, named, 'every player is found again');
  assert.deepEqual(tactic.preferredLineup, slot.preferredLineup);
  assert.equal(tactic.preferredLibero, slot.preferredLibero);
  assert.equal(tactic.preferredFormation, Formation.FiveOne);
  const { familiarity: _a, ...was } = slot.tactics;
  const { familiarity, ...now } = tactic.tactics;
  assert.deepEqual(now, was, 'every instruction comes back as it was');
  assert.deepEqual(now.servers, { [server]: { style: 'jumpFloat', zone: 5 } });
  assert.equal(familiarity?.attack, NEW_TACTIC_FAMILIARITY, 'a loaded tactic is new to the side');
});

test('at another club, players not in the squad leave their slots to the usual pick', () => {
  const { world, club, other, slot } = aTactic();
  const read = parseTacticFile(serialiseTacticFile(tacticToFile(slot, world.players, club.name)));
  assert.ok(read.ok);
  const { tactic, found, named } = tacticFromFile(read.file, other.players, world.players);
  assert.ok(named >= 6);
  assert.equal(found, 0);
  assert.deepEqual(tactic.preferredLineup, [], 'no one found: no team sheet, picked afresh');
  assert.equal(tactic.preferredLibero, -1);
  assert.equal(tactic.preferredFormation, undefined);
  assert.equal(tactic.tactics.servers, undefined);
  assert.equal(tactic.tactics.offense, OffensiveSystem.PipeHeavy, 'the instructions still come');

  // One of the six moves to the other club: he is found there, by who he is.
  const moved = slot.preferredLineup[1];
  const some = tacticFromFile(read.file, [...other.players, moved], world.players);
  assert.equal(some.found, 1);
  assert.equal(some.tactic.preferredLineup[1], moved);
  assert.deepEqual(some.tactic.preferredLineup.filter((p) => p >= 0), [moved]);
});

test('files that are not tactics are refused with a reason', () => {
  for (const text of ['', 'not json', '[]', '{"format":"something-else","version":1,"tactics":{}}',
    `{"format":"${TACTIC_FILE_FORMAT}","version":1}`, `{"format":"${TACTIC_FILE_FORMAT}","tactics":{}}`,
    `{"format":"${TACTIC_FILE_FORMAT}","version":1,"tactics":{}}`.padEnd(600_000)]) {
    const r = parseTacticFile(text);
    assert.equal(r.ok, false, text.slice(0, 40));
    if (!r.ok) assert.ok(r.error.length > 0);
  }
});

test('a damaged or hand-edited file loads, its bad values put back to the defaults', () => {
  const { world, club, slot } = aTactic();
  const f = JSON.parse(serialiseTacticFile(tacticToFile(slot, world.players, club.name)));
  f.tactics.offense = 99;
  f.tactics.tempo = 'fast';
  f.tactics.rotations[0].serveTarget = -4;
  f.tactics.rotations[2].play = 'teleport';
  f.tactics.blockPlans.opposite.spots = [1, 2];
  f.tactics.zones.B = 'nonsense';
  f.tactics.defence = { oh: { lb: { u: 7, v: 0.5 } } };
  f.players.lineup[3] = { hacked: true };
  const r = parseTacticFile(`﻿${JSON.stringify(f)}`);
  assert.ok(r.ok);
  assert.ok(r.warnings.length >= 7, r.warnings.join('; '));
  assert.equal(r.file.tactics.offense, OffensiveSystem.Balanced);
  assert.equal(r.file.tactics.tempo, Tempo.Balanced);
  assert.equal(r.file.tactics.rotations[0].serveTarget, 0);
  assert.equal(r.file.tactics.rotations[2].play, undefined);
  assert.equal(r.file.tactics.blockPlans?.opposite.spots, undefined);
  assert.equal(r.file.tactics.zones?.B.middle !== undefined, true);
  assert.ok(r.file.tactics.defence?.oh.lb.u !== undefined && r.file.tactics.defence.oh.lb.u <= 1);
  assert.equal(r.file.players.lineup[3], null);
  // Still a playable tactic for the club.
  const { tactic } = tacticFromFile(r.file, club.players, world.players);
  assert.equal(tactic.tactics.rotations.length, 6);
  assert.equal(tactic.preferredLineup[3], -1);
});

test('a file from a newer game still loads, with a warning', () => {
  const { world, club, slot } = aTactic();
  const f = JSON.parse(serialiseTacticFile(tacticToFile(slot, world.players, club.name)));
  f.version = 7;
  f.tactics.someNewThing = { x: 1 };
  const r = parseTacticFile(JSON.stringify(f));
  assert.ok(r.ok);
  assert.equal(r.warnings.length, 1);
  assert.equal('someNewThing' in r.file.tactics, false, 'what it does not know is left out');
});

test('a file loads into a new slot, or in place of the loaded one when all are taken', () => {
  const { world, club, slot } = aTactic();
  const read = parseTacticFile(serialiseTacticFile(tacticToFile({ ...slot, name: 'Shared' }, world.players)));
  assert.ok(read.ok);
  const first = addTactic(club, tacticFromFile(read.file, club.players, world.players).tactic);
  assert.equal(first.replaced, null);
  assert.equal(tacticSlots(club).length, 2);
  assert.equal(activeTactic(club), 1);
  assert.equal(club.tactics.offense, OffensiveSystem.PipeHeavy);

  while (tacticSlots(club).length < MAX_TACTICS) newTactic(club);
  const loaded = tacticSlots(club)[activeTactic(club)].name;
  const again = addTactic(club, tacticFromFile(read.file, club.players, world.players).tactic);
  assert.equal(again.replaced, loaded);
  assert.equal(tacticSlots(club).length, MAX_TACTICS);
  assert.equal(tacticSlots(club)[again.index].name, 'Shared');
});

test('tactic names make safe file names', () => {
  assert.equal(tacticFileName('My Tactic'), 'My Tactic.vmtac');
  assert.equal(tacticFileName('  a/b\\c:d*e?  '), 'abcde.vmtac');
  assert.equal(tacticFileName('...'), 'Tactic.vmtac');
  assert.equal(tacticFileName('CON'), 'Tactic.vmtac');
});
