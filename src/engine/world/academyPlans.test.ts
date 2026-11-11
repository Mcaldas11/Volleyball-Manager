import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from './worldGen.ts';
import { stubManager, type World } from './world.ts';
import { appointManager } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { generateYouthIntake } from './progression.ts';
import { benchLevel, planAdvice, planOf, readyToPromote, setCareerPlan } from './academyPlans.ts';
import { loanOf } from './loans.ts';
import { PlayerFlag } from '../model/players.ts';

function managed(seed: number): { world: World; run: (days: number) => void } {
  const world = generateWorld({ seed, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  generateYouthIntake(world);
  generateYouthIntake(world);
  appointManager(world, world.clubs.find((c) => c.tier === 1 && c.players.length >= 12)!.id);
  return { world, run: (days) => { for (let i = 0; i < days; i++) advanceDay(world, ctx); } };
}

test('the head of youth advises a path: a prospect as good as the bench is ready, one near it wants senior games', () => {
  const { world } = managed(61);
  const club = world.clubs[world.userClubId];
  const store = world.players;
  const p = club.youthPlayers[0];
  const bench = benchLevel(world, club);
  store.currentAbility[p] = bench + 10;
  if (club.players.length < 20) {
    assert.equal(readyToPromote(world, club, p), true);
    assert.equal(planAdvice(world, p).path, 'promote');
  }
  store.currentAbility[p] = Math.round(bench * 0.9);
  store.playingTime[p] = 70;
  if (store.ageOn(p, world.year, 181) >= 16) assert.equal(planAdvice(world, p).path, 'loan');
  store.currentAbility[p] = Math.round(bench * 0.5);
  assert.equal(planAdvice(world, p).path, 'grow');
});

test('a promotion plan brings the prospect up the day he is ready — and the plan ends there', () => {
  const { world, run } = managed(62);
  const club = world.clubs[world.userClubId];
  const store = world.players;
  // Room in the squad for him.
  while (club.players.length >= 19) club.players.pop();
  const p = club.youthPlayers[0];
  setCareerPlan(world, p, 'promote');
  assert.equal(planOf(world, p)?.path, 'promote');
  run(1);
  assert.ok(club.youthPlayers.includes(p), 'not ready yet: he stays');
  store.currentAbility[p] = benchLevel(world, club) + 30;
  store.potentialAbility[p] = Math.max(store.potentialAbility[p], store.currentAbility[p] + 100);
  run(1);
  assert.ok(club.players.includes(p) && !club.youthPlayers.includes(p), 'promoted');
  assert.equal(store.hasFlag(p, PlayerFlag.Youth), false);
  assert.equal(planOf(world, p), undefined);
  assert.ok(world.messages.some((m) => m.subject.includes('is promoted') && m.playerIdx === p));
  assert.ok((world.playerEvents?.[p] ?? []).some((e) => e.kind === 'promoted'), 'on his timeline');
});

test('a loan plan sends him out when the window is open and a club will play him; a month later the report comes', () => {
  const { world, run } = managed(63);
  const club = world.clubs[world.userClubId];
  const store = world.players;
  const p = club.youthPlayers.find((q) => store.ageOn(q, world.year, 181) >= 16)!;
  setCareerPlan(world, p, 'loan');
  run(2);
  const loan = loanOf(world, p);
  assert.ok(loan !== undefined && loan.academy === true, 'out on loan in the summer window');
  assert.ok(world.messages.some((m) => m.subject.includes('goes on loan')));
  assert.equal(planOf(world, p)?.path, 'loan', 'the plan goes on while he is away');
  run(32);
  assert.ok(world.messages.some((m) => m.subject.startsWith("Career plans: the month's report")), 'the monthly report');
});

test('a prospect who leaves the club takes his plan with him', () => {
  const { world, run } = managed(64);
  const club = world.clubs[world.userClubId];
  const p = club.youthPlayers[0];
  setCareerPlan(world, p, 'grow');
  club.youthPlayers = club.youthPlayers.filter((x) => x !== p);
  world.players.clubId[p] = -1;
  run(1);
  assert.equal(planOf(world, p), undefined);
});
