import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager } from './world.ts';
import { processScoutingQueue } from './scouting.ts';

test('processScoutingQueue resolves due assignments and logs a message', () => {
  const world = generateWorld({ seed: 1, startYear: 2026, scale: 'small', manager: stubManager() });
  const duePlayer = 0;
  const notDuePlayer = 1;
  world.scoutingQueue.push(
    { playerIdx: duePlayer, completesOnDay: world.day, matches: 5 },
    { playerIdx: notDuePlayer, completesOnDay: world.day + 7, matches: 5 },
  );

  processScoutingQueue(world);

  assert.equal(world.scoutingKnowledge.get(duePlayer)?.matchesWatched, 5);
  assert.equal(world.scoutingKnowledge.has(notDuePlayer), false);
  assert.equal(world.scoutingQueue.length, 1);
  assert.equal(world.scoutingQueue[0].playerIdx, notDuePlayer);
  assert.equal(world.messages.length, 1);
  assert.equal(world.messages[0].subject, 'Scouting report ready');
});

test('processScoutingQueue accumulates matches watched, capped at 80', () => {
  const world = generateWorld({ seed: 2, startYear: 2026, scale: 'small', manager: stubManager() });
  world.scoutingKnowledge.set(0, { confidence: 0, matchesWatched: 70 });
  world.scoutingQueue.push({ playerIdx: 0, completesOnDay: world.day, matches: 20 });

  processScoutingQueue(world);

  assert.equal(world.scoutingKnowledge.get(0)?.matchesWatched, 80);
});
