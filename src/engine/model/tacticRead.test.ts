import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultTactics, OffensiveSystem, ServeStrategy, Tempo } from '../match/tactics.ts';
import { bestKnown, exposure, READ_FULL, READ_ONSET, readLevel, studyTactic, type TacticRead } from './tacticRead.ts';

function watched(matches: number, t = defaultTactics(), read: TacticRead = { seen: {} }): TacticRead {
  for (let i = 0; i < matches; i++) studyTactic(read, t);
  return read;
}

test('a new tactic gives nothing away; one played for most of a season starts to be read; a season and a half, completely', () => {
  const t = defaultTactics();
  assert.equal(readLevel(undefined, t), 0);
  assert.ok(readLevel(watched(READ_ONSET), t) < 1e-9);
  const season = readLevel(watched(32), t);
  assert.ok(season > 0.2 && season < 0.8, `after a season: ${season}`);
  assert.equal(readLevel(watched(READ_FULL), t), 1);
  assert.ok(Math.abs(exposure(watched(10), t) - 10) < 1e-9, 'exposure counts matches watched');
});

test('each instruction changed is new to them — a few tweaks throw them, the rest they still know', () => {
  const t = defaultTactics();
  const read = watched(45, t);
  const before = readLevel(read, t);
  const tweaked = structuredClone(t);
  tweaked.tempo = Tempo.Fast;
  tweaked.serve = ServeStrategy.Risky;
  const after = readLevel(read, tweaked);
  assert.ok(after < before - 0.15, `${before} -> ${after}`);
  assert.ok(after > 0, 'the rest of the plan they still know');

  const overhaul = structuredClone(tweaked);
  overhaul.offense = OffensiveSystem.PipeHeavy;
  overhaul.formation = 1;
  overhaul.defense = 1;
  assert.ok(readLevel(read, overhaul) < after, 'the more is changed, the less they know');
});

test('what is no longer played fades from memory', () => {
  const t = defaultTactics();
  const read = watched(45, t);
  const other = structuredClone(t);
  other.offense = OffensiveSystem.OutsideFocused;
  const oldOffence = `offense=${OffensiveSystem.Balanced}`;
  const knownBefore = read.seen[oldOffence];
  watched(30, other, read);
  assert.ok(read.seen[oldOffence] < knownBefore * 0.5, 'the old offence is more than half forgotten');
  assert.ok(exposure(read, t) < exposure(watched(75, t), t), 'so going back to it is part new again');
});

test('the assistant names what they know best — the heaviest parts of the plan first', () => {
  const t = defaultTactics();
  assert.deepEqual(bestKnown(undefined, t), []);
  assert.deepEqual(bestKnown(watched(5, t), t), ['offence', 'system', 'defence']);
});
