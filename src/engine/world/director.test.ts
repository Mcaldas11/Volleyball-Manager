import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../core/rng.ts';
import { generateStaff, generateWorld } from './worldGen.ts';
import { seasonEndDay, stubManager } from './world.ts';
import { appointManager } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { StaffRole } from '../model/staff.ts';
import { PlayerFlag } from '../model/players.ts';
import { delegateDeal, directorBlock, directorTasks } from './director.ts';
import { pendingMoveOf } from './moves.ts';

function career(withDirector = true) {
  const world = generateWorld({ seed: 81, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[1];
  appointManager(world, club.id);
  club.finances.transferBudget = 5_000_000;
  club.finances.balance = 8_000_000;
  club.finances.wageBudget += 2_000_000;
  if (withDirector) {
    const s = generateStaff(world, new Rng(5), club.nation, StaffRole.DirectorOfFootball, 8000);
    s.clubId = club.id;
    club.staff.push(s.id);
  }
  return { world, ctx, club };
}

/** A decent player at another club the manager could afford. */
function target(world: ReturnType<typeof career>['world'], clubId: number): number {
  const store = world.players;
  for (let i = 0; i < store.count; i++) {
    if (!store.isActive(i) || store.clubId[i] < 0 || store.clubId[i] === clubId || store.hasFlag(i, PlayerFlag.Youth)) continue;
    if (store.value[i] > 100_000 && store.value[i] < 600_000 && store.ageOn(i, world.year, 181) < 29) return i;
  }
  throw new Error('no target');
}

test('without a director, there is nobody to hand a deal to', () => {
  const { world, club } = career(false);
  assert.match(directorBlock(world, club, target(world, club.id), 'transfer') ?? '', /no Director of Football/);
});

test('given room to work, the director signs the player — and never past the limit', () => {
  const { world, ctx, club } = career();
  const store = world.players;
  const p = target(world, club.id);
  const r = delegateDeal(world, club, p, 'transfer', store.value[p] * 2, store.wage[p] * 2);
  assert.ok(r.ok, r.text);
  for (let d = 0; d < 60 && directorTasks(world)[0].status === 'working'; d++) advanceDay(world, ctx, {});
  const task = directorTasks(world)[0];
  assert.equal(task.status, 'done', task.outcome);
  assert.ok(store.clubId[p] === club.id || pendingMoveOf(world, p)?.toClubId === club.id, 'he is ours, or joins when the window opens');
  assert.ok(store.wage[p] <= task.maxWage || pendingMoveOf(world, p) !== undefined);
  assert.ok(world.messages.some((m) => m.subject.startsWith('Done:')));
});

test('with too little to spend, he walks away and says why', () => {
  const { world, ctx, club } = career();
  const store = world.players;
  const p = target(world, club.id);
  assert.ok(delegateDeal(world, club, p, 'transfer', Math.round(store.value[p] * 0.2), store.wage[p] * 2).ok);
  for (let d = 0; d < 40 && directorTasks(world)[0].status === 'working'; d++) advanceDay(world, ctx, {});
  const task = directorTasks(world)[0];
  assert.equal(task.status, 'failed');
  assert.match(task.outcome ?? '', /walked away|more than/);
  assert.notEqual(store.clubId[p], club.id);
  assert.ok(!world.talks.some((t) => t.playerIdx === p), 'the talks are closed');
});

test('a renewal handed to him: one of our own signs again', () => {
  const { world, ctx, club } = career();
  const store = world.players;
  const p = club.players.find((q) => !store.hasFlag(q, PlayerFlag.Youth) && store.ageOn(q, world.year, 181) < 30)!;
  store.contractUntil[p] = seasonEndDay(world.season);
  const before = store.contractUntil[p];
  assert.ok(delegateDeal(world, club, p, 'renewal', 0, store.wage[p] * 3).ok);
  for (let d = 0; d < 40 && directorTasks(world)[0].status === 'working'; d++) advanceDay(world, ctx, {});
  assert.equal(directorTasks(world)[0].status, 'done', directorTasks(world)[0].outcome);
  assert.ok(store.contractUntil[p] > before);
});
