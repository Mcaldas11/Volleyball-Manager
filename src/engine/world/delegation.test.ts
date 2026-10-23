import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../core/rng.ts';
import { generateStaff, generateWorld } from './worldGen.ts';
import { DAYS_PER_SEASON, seasonEndDay, stubManager } from './world.ts';
import { appointManager } from './career.ts';
import { advanceDay, newSeasonContext, startSeason } from '../season/seasonEngine.ts';
import { StaffRole } from '../model/staff.ts';
import { PlayerFlag } from '../model/players.ts';
import { friendliesOf } from '../season/friendlies.ts';
import { generateInterviewSessions } from './interviews.ts';
import { loadOf, planOf } from './training.ts';
import { delegationDay, delegationOf, setDelegation } from './delegation.ts';
import { directorTasks } from './director.ts';

function career() {
  const world = generateWorld({ seed: 82, startYear: 2026, scale: 'small', manager: stubManager() });
  const ctx = newSeasonContext();
  startSeason(world, ctx);
  const club = world.clubs.filter((c) => c.tier === 1 && c.players.length >= 12)[3];
  appointManager(world, club.id);
  return { world, ctx, club };
}

test('a job can only go to someone the club has: no director, no handing him the renewals', () => {
  const { world } = career();
  assert.match(setDelegation(world, 'renewals', 'director'), /no Director of Football/);
  assert.equal(delegationOf(world).renewals, 'manager');
  assert.match(setDelegation(world, 'press', 'assistant'), /takes care/);
  assert.equal(delegationOf(world).press, 'assistant');
});

test('the press handed to the assistant: he fronts the conference, and nothing waits on the manager', () => {
  const { world, ctx, club } = career();
  setDelegation(world, 'press', 'assistant');
  for (let d = 0; d < 120 && !world.messages.some((m) => m.category === 'interview'); d++) advanceDay(world, ctx, {});
  const msg = world.messages.find((m) => m.category === 'interview');
  assert.ok(msg !== undefined, 'a conference came up');
  assert.match(msg!.body, /fronted the/);
  assert.equal(world.pendingInterviews.filter((s) => s.national === undefined).length, 0);
  void club;
  void generateInterviewSessions;
});

test('the training handed to the assistant: the manager\'s own settings stop counting', () => {
  const { world, club } = career();
  const p = club.players[0];
  const plan = planOf(club);
  plan.assistantIndividual = false;
  plan.individual[p] = { focus: 'serving', load: 'extra' };
  world.players.condition[p] = 100;
  assert.equal(loadOf(world, club, p), 'extra');
  setDelegation(world, 'training', 'assistant');
  assert.equal(loadOf(world, club, p), 'normal', 'the assistant runs it his way');
});

test('the friendlies handed over: the pre-season gets booked', () => {
  const { world, ctx, club } = career();
  setDelegation(world, 'friendlies', 'assistant');
  // The FIVB calendar's friendlies come late in the summer: run on until they are booked.
  for (let d = 0; d < 110 && friendliesOf(world, club.id).length < 3; d++) advanceDay(world, ctx, {});
  assert.ok(friendliesOf(world, club.id).length >= 3, `booked ${friendliesOf(world, club.id).length}`);
  assert.ok(world.messages.some((m) => m.subject.startsWith('Friendly arranged')));
});

test('the renewals handed to the director: he keeps the good ones and says who he lets go', () => {
  const { world, club } = career();
  const s = generateStaff(world, new Rng(9), club.nation, StaffRole.DirectorOfFootball, 8000);
  s.clubId = club.id;
  club.staff.push(s.id);
  club.finances.wageBudget += 3_000_000;
  assert.match(setDelegation(world, 'renewals', 'director'), /takes care/);
  const store = world.players;
  const seniors = club.players.filter((p) => !store.hasFlag(p, PlayerFlag.Youth));
  const best = [...seniors].sort((a, b) => store.currentAbility[b] - store.currentAbility[a]);
  store.contractUntil[best[0]] = seasonEndDay(world.season);
  store.birthYear[best[0]] = world.year - 26;
  const worst = best[best.length - 1];
  store.contractUntil[worst] = seasonEndDay(world.season);
  // Not a youngster still growing, either: nothing to keep him for.
  store.birthYear[worst] = world.year - 30;
  store.potentialAbility[worst] = store.currentAbility[worst];
  world.day = world.season * DAYS_PER_SEASON + 184;
  delegationDay(world);
  assert.ok(directorTasks(world).some((t) => t.p === best[0] && t.kind === 'renewal'), 'talks to keep the best');
  assert.ok(!directorTasks(world).some((t) => t.p === worst), 'not the weakest');
  assert.ok(world.messages.some((m) => m.subject === 'Contracts running out: my plan'));
});
