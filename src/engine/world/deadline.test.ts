import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager, windowCloseDay } from './world.ts';
import { appointManager } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { clockLabel, DEADLINE_OPENS, DEADLINE_SHUTS, deadlineToday } from './deadline.ts';

test('deadline day: planned in the morning hour by hour, and the deals named are the ones done at night', () => {
  const world = generateWorld({ seed: 85, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[2];
  appointManager(world, club.id);
  for (let d = 0; d < 200 && windowCloseDay(world.day) !== world.day; d++) {
    assert.equal(deadlineToday(world), undefined, 'no plan before the day');
    advanceDay(world, ctx, {});
  }
  const plan = deadlineToday(world)!;
  assert.ok(plan !== undefined, 'planned that morning');
  assert.ok(plan.events.length >= 1);
  assert.ok(plan.events.every((e, i) => i === 0 || plan.events[i - 1].at <= e.at), 'in order');
  assert.ok(plan.events.every((e) => e.at >= DEADLINE_OPENS && e.at < DEADLINE_SHUTS));
  assert.equal(plan.events.at(-1)!.kind, 'close');
  assert.ok(world.messages.some((m) => m.subject === 'Deadline day'));
  const deals = plan.deals;
  advanceDay(world, ctx, {});
  for (const d of deals) assert.equal(world.players.clubId[d.p], d.to, `${world.players.fullName(d.p)} moved as planned`);
  assert.equal(deadlineToday(world), undefined, 'and the next day it is over');
  assert.equal(clockLabel(9 * 60 + 5), '09:05');
  assert.equal(clockLabel(DEADLINE_SHUTS), '23:59');
});
